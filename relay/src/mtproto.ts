/**
 * MTProto (Telegram user-account) manager — GramJS.
 *
 * Lets the relay act AS the human user instead of as a bot: the app types a message,
 * the relay sends it from the user's account to a target bot/peer, and the bot's reply
 * arrives via a NewMessage event handler. Replies are buffered into the SAME `updates`
 * table the bot-token poller uses, so the mobile `/pull` + Expo push paths are unchanged.
 *
 * One Telegram account per device (single-user app). Session strings are persisted
 * encrypted (reuse crypto via store.setSessionString/decryptSession) so clients can be
 * reconstructed on boot. Login (phone → code → optional 2FA) is driven over HTTP; the
 * connected-but-unsigned client is held in memory between steps.
 */
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { computeCheck } from "telegram/Password.js";
import { CustomFile } from "telegram/client/uploads.js";
import { config } from "./config.js";
import { store } from "./store.js";
import { sendPushes } from "./push.js";
import { log } from "./log.js";
import type { TgUpdate, LinkPreview } from "./types.js";

/** big-integer Integer or native value → JS number (Telegram ids fit in 2^53 for users). */
function idToNum(x: unknown): number {
  if (x == null) return 0;
  const anyX = x as { toJSNumber?: () => number };
  if (typeof anyX.toJSNumber === "function") return anyX.toJSNumber();
  return Number(x as number);
}

type Pending = { client: TelegramClient; phoneCodeHash: string; phone: string };

const clients = new Map<string, TelegramClient>(); // signed-in, live (deviceId → client)
const pending = new Map<string, Pending>(); // mid-login (deviceId → connected client)

function newClient(session = ""): TelegramClient {
  const client = new TelegramClient(new StringSession(session), config.apiId, config.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });
  try {
    client.setLogLevel("error" as never); // quiet GramJS chatter
  } catch {
    /* older builds: ignore */
  }
  return client;
}

function rpcError(e: unknown): string {
  const anyE = e as { errorMessage?: string; message?: string };
  return anyE?.errorMessage ?? anyE?.message ?? String(e);
}

/**
 * Telegram delivers formatting as message *entities* (offset/length over the UTF-16 text),
 * not as literal markdown. Reconstruct GFM markdown so the app's renderer shows code
 * blocks, bold, links, etc. instead of a flattened plain paragraph. Offsets are UTF-16
 * code units — JS string indices are too, so they line up.
 */
type MdEntity = { className: string; offset: number; length: number; url?: string; language?: string };

function entitiesToMarkdown(text: string, entities?: MdEntity[]): string {
  if (!entities || entities.length === 0) return text;
  const opens = new Map<number, string[]>();
  const closes = new Map<number, string[]>();
  const add = (m: Map<number, string[]>, i: number, s: string, prepend = false) => {
    const arr = m.get(i) ?? [];
    prepend ? arr.unshift(s) : arr.push(s);
    m.set(i, arr);
  };
  for (const e of entities) {
    const end = e.offset + e.length;
    let open = "";
    let close = "";
    switch (e.className) {
      case "MessageEntityBold": open = close = "**"; break;
      case "MessageEntityItalic": open = close = "_"; break;
      case "MessageEntityStrike": open = close = "~~"; break;
      case "MessageEntityCode": open = close = "`"; break;
      case "MessageEntityPre": open = "\n```" + (e.language ?? "") + "\n"; close = "\n```\n"; break;
      case "MessageEntityBlockquote": open = "\n> "; close = "\n"; break;
      case "MessageEntityTextUrl": open = "["; close = `](${e.url ?? ""})`; break;
      default: continue; // urls/mentions/etc. — leave the raw text
    }
    add(opens, e.offset, open);
    add(closes, end, close, true); // close inner-most first
  }
  let out = "";
  for (let i = 0; i <= text.length; i++) {
    for (const c of closes.get(i) ?? []) out += c;
    for (const o of opens.get(i) ?? []) out += o;
    if (i < text.length) out += text[i];
  }
  return out;
}

type MediaDescriptor = { kind: string; name: string; mime: string; size?: number };

/** Classify a message's media (photo/document) so the app can render received files. */
function classifyMedia(msg: any): MediaDescriptor | null {
  if (msg.photo) return { kind: "image", name: "photo.jpg", mime: "image/jpeg" };
  const doc = msg.document;
  if (!doc) return null;
  const mime: string = doc.mimeType || "application/octet-stream";
  const attrs: any[] = doc.attributes || [];
  const fileName = attrs.find((a) => a.className === "DocumentAttributeFilename")?.fileName;
  const audio = attrs.find((a) => a.className === "DocumentAttributeAudio");
  const isVideo = attrs.some((a) => a.className === "DocumentAttributeVideo");
  let kind = "document";
  if (mime.startsWith("image")) kind = "image";
  else if (mime.startsWith("video") || isVideo) kind = "video";
  else if (audio?.voice) kind = "voice";
  else if (mime.startsWith("audio") || audio) kind = "audio";
  const name = fileName || (kind === "video" ? "video.mp4" : kind === "voice" ? "voice.ogg" : kind === "image" ? "image.jpg" : "file");
  const size = doc.size != null ? Number(doc.size) : undefined;
  return { kind, name, mime, size };
}

/** Attach the incoming-message receiver that buffers replies into `updates` + pushes. */
function attachReceiver(deviceId: string, client: TelegramClient): void {
  client.addEventHandler(async (event: unknown) => {
    try {
      const msg = (event as { message?: any }).message;
      if (!msg) return;
      const outgoing = !!msg.out; // true = the user sent it (possibly from another client)
      // In a private chat, chatId is the peer (the bot) for BOTH directions; senderId is
      // the bot (incoming) or self (outgoing), so always key on chatId.
      const peerId = idToNum(msg.chatId ?? msg.senderId);
      if (!peerId) return;
      const peer = store.getPeer(deviceId, peerId);
      if (!peer) return; // not a subscribed peer — ignore
      const text: string = entitiesToMarkdown(msg.message ?? "", msg.entities as MdEntity[] | undefined);
      const mediaInfo = classifyMedia(msg);
      if (!text && !mediaInfo) return; // nothing renderable (e.g. service message)
      // Telegram message_id is monotonic per chat → preserves order and is the /pull cursor.
      const updateId = Number(msg.id);
      // Telegram auto-attaches a webpage preview (title/desc/photo) for links → surface it.
      let preview: LinkPreview | undefined;
      const wp = (msg as { media?: { webpage?: any } }).media?.webpage;
      if (wp && wp.className === "WebPage" && wp.url) {
        preview = {
          url: String(wp.url),
          title: wp.title ? String(wp.title) : undefined,
          description: wp.description ? String(wp.description) : undefined,
          siteName: wp.siteName ? String(wp.siteName) : undefined,
          image: wp.photo
            ? `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${updateId}`
            : undefined,
        };
      }
      const media = mediaInfo
        ? { ...mediaInfo, url: `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${updateId}` }
        : undefined;
      const update: TgUpdate = {
        update_id: updateId,
        message: {
          message_id: updateId,
          date: Number(msg.date),
          text,
          chat: { id: peerId, type: "private" },
          from: { id: peerId, is_bot: !outgoing, first_name: peer.title ?? "" },
          outgoing,
          ...(preview ? { preview } : {}),
          ...(media ? { media } : {}),
        },
      };
      store.insertUpdate(peerId, update);
      // Only push for the bot's replies — never notify the user about their own messages.
      if (!outgoing) {
        const targets = store.pushTargets(peerId);
        if (targets.length && update.message) {
          await sendPushes(
            targets.map((t) => ({
              expoPushToken: t.expo_push_token,
              botTitle: peer.title ?? "Bot",
              m: update.message!,
              updateId,
              buddyId: t.buddy_id,
            })),
          );
        }
      }
    } catch (e) {
      log.warn(`mtproto receive handler error: ${rpcError(e)}`);
    }
  }, new NewMessage({}));
}

async function finishLogin(deviceId: string, client: TelegramClient): Promise<number> {
  const me = (await client.getMe()) as { id: unknown };
  const tgUserId = idToNum(me.id);
  const sessionString = client.session.save() as unknown as string;
  store.setSessionString(deviceId, sessionString, tgUserId);
  pending.delete(deviceId);
  clients.set(deviceId, client);
  attachReceiver(deviceId, client);
  log.info(`mtproto signed in device=${deviceId} tgUserId=${tgUserId}`);
  return tgUserId;
}

export const mtproto = {
  enabled: config.mtprotoEnabled,

  /** Step 1: connect a fresh client and request a login code for `phone`. */
  async startLogin(deviceId: string, phone: string): Promise<void> {
    const prev = pending.get(deviceId);
    if (prev) await prev.client.disconnect().catch(() => undefined);
    const client = newClient();
    await client.connect();
    const res = (await client.sendCode({ apiId: config.apiId, apiHash: config.apiHash }, phone)) as {
      phoneCodeHash: string;
    };
    pending.set(deviceId, { client, phoneCodeHash: res.phoneCodeHash, phone });
    store.upsertUserSession({ deviceId, phone, status: "pending" });
  },

  /** Step 2: submit the login code. Returns needs2fa=true when a cloud password is set. */
  async confirmCode(deviceId: string, code: string): Promise<{ signedIn: boolean; tgUserId?: number }> {
    const p = pending.get(deviceId);
    if (!p) throw new Error("no pending login");
    try {
      await p.client.invoke(
        new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code }),
      );
    } catch (e) {
      if (rpcError(e).includes("SESSION_PASSWORD_NEEDED")) return { signedIn: false };
      throw e;
    }
    const tgUserId = await finishLogin(deviceId, p.client);
    return { signedIn: true, tgUserId };
  },

  /** Step 3 (optional): submit the 2FA cloud password (SRP handled by GramJS). */
  async confirm2fa(deviceId: string, password: string): Promise<number> {
    const p = pending.get(deviceId);
    if (!p) throw new Error("no pending login");
    const pwd = await p.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwd, password);
    await p.client.invoke(new Api.auth.CheckPassword({ password: check }));
    return finishLogin(deviceId, p.client);
  },

  /** Resolve a @username to a peer (caches id + access hash for sending). */
  async resolvePeer(
    deviceId: string,
    username: string,
  ): Promise<{ peerId: number; username: string; title: string }> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const handle = username.replace(/^@/, "");
    const ent = (await client.getEntity(handle)) as {
      id: unknown;
      accessHash?: unknown;
      username?: string;
      firstName?: string;
      title?: string;
    };
    const peerId = idToNum(ent.id);
    const title = ent.firstName ?? ent.title ?? ent.username ?? handle;
    store.upsertPeer({
      deviceId,
      peerId,
      username: ent.username ?? handle,
      title,
      accessHash: ent.accessHash != null ? String(ent.accessHash) : undefined,
    });
    return { peerId, username: ent.username ?? handle, title };
  },

  /** Send `text` to `peerId` as the user. Returns the sent message id. */
  async sendAs(deviceId: string, peerId: number, text: string, replyTo?: number): Promise<number> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const peer = store.getPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const opts = replyTo ? { message: text, replyTo } : { message: text };
    try {
      const sent = (await client.sendMessage(target, opts)) as { id: number };
      return Number(sent.id);
    } catch (e) {
      // Stale access hash / entity cache → re-resolve by username and retry once.
      if (peer?.username) {
        await this.resolvePeer(deviceId, peer.username);
        const sent = (await client.sendMessage(peer.username, opts)) as { id: number };
        return Number(sent.id);
      }
      throw e;
    }
  },

  /** Send a file (document/image/video/voice/audio) as the user. Returns the message id. */
  async sendMediaAs(
    deviceId: string,
    peerId: number,
    opts: { buffer: Buffer; fileName: string; mime: string; kind: string; caption?: string },
  ): Promise<number> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const peer = store.getPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const { buffer, fileName, mime, kind, caption } = opts;
    const file = new CustomFile(fileName, buffer.length, "", buffer);
    const sent = (await client.sendFile(target, {
      file,
      caption,
      // documents (pdf/docx/xlsx/pptx/txt) keep their filename; media (image/video) send inline.
      forceDocument: kind === "document",
      voiceNote: kind === "voice",
      supportsStreaming: kind === "video",
      attributes:
        kind === "document" || kind === "audio"
          ? [new Api.DocumentAttributeFilename({ fileName })]
          : undefined,
    })) as { id: number };
    void mime; // GramJS infers mime from the filename extension
    return Number(sent.id);
  },

  /** Send several files as ONE Telegram album (media group). Returns the first message id. */
  async sendMediaGroupAs(
    deviceId: string,
    peerId: number,
    items: { buffer: Buffer; fileName: string; mime: string; kind: string }[],
    caption?: string,
  ): Promise<number> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const peer = store.getPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const allDocs = items.every((i) => i.kind === "document");
    const files = items.map((i) => new CustomFile(i.fileName, i.buffer.length, "", i.buffer));
    const sent = (await client.sendFile(target, {
      file: files, // array → grouped album (one bubble in Telegram clients)
      caption,
      forceDocument: allDocs || undefined,
    })) as { id: number } | { id: number }[];
    const first = Array.isArray(sent) ? sent[0] : sent;
    return Number(first?.id ?? 0);
  },

  /** Download a message's webpage preview photo (for the /media proxy). */
  async downloadMessageMedia(
    deviceId: string,
    peerId: number,
    msgId: number,
  ): Promise<{ buffer: Buffer; mime: string } | null> {
    const client = clients.get(deviceId);
    if (!client) return null;
    const msgs = (await client.getMessages(peerId, { ids: [msgId] })) as unknown as Array<any>;
    const m = msgs?.[0];
    if (!m?.media) return null;
    // Webpage preview photo, or the message's own photo/document.
    const wp = m.media?.webpage;
    let mime = "application/octet-stream";
    if (wp?.photo) mime = "image/jpeg";
    else if (m.photo) mime = "image/jpeg";
    else if (m.document?.mimeType) mime = String(m.document.mimeType);
    const raw = (await client.downloadMedia(m.media as never, {})) as unknown;
    if (!raw) return null;
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    return { buffer, mime };
  },

  async logout(deviceId: string): Promise<void> {
    const client = clients.get(deviceId);
    if (client) {
      await client.invoke(new Api.auth.LogOut()).catch(() => undefined);
      await client.disconnect().catch(() => undefined);
      clients.delete(deviceId);
    }
    const p = pending.get(deviceId);
    if (p) {
      await p.client.disconnect().catch(() => undefined);
      pending.delete(deviceId);
    }
    store.revokeSession(deviceId);
  },

  isSignedIn(deviceId: string): boolean {
    return clients.has(deviceId);
  },

  /** Reconstruct all active sessions on boot / periodically (idempotent). */
  async reconnectAll(): Promise<void> {
    if (!config.mtprotoEnabled) return;
    for (const s of store.activeSessions()) {
      if (clients.has(s.device_id)) continue;
      try {
        const client = newClient(store.decryptSession(s));
        await client.connect();
        clients.set(s.device_id, client);
        attachReceiver(s.device_id, client);
        log.info(`mtproto reconnected device=${s.device_id}`);
      } catch (e) {
        const msg = rpcError(e);
        log.warn(`mtproto reconnect failed device=${s.device_id}: ${msg}`);
        if (msg.includes("AUTH_KEY_UNREGISTERED") || msg.includes("malformed ciphertext")) {
          store.revokeSession(s.device_id);
        }
      }
    }
  },
};
