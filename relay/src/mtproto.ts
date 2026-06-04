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
import bigInt from "big-integer";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { EditedMessage } from "telegram/events/EditedMessage.js";
import { computeCheck } from "telegram/Password.js";
import { CustomFile } from "telegram/client/uploads.js";
import { config } from "./config.js";
import { store } from "./store.js";
import { sendPushes } from "./push.js";
import { log } from "./log.js";
import { suggestHelperItems } from "./helper.js";
import type { TgUpdate, LinkPreview, AgentPayload, InlineKeyboard, InlineKeyboardButton } from "./types.js";

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
const helperTimers = new Map<string, ReturnType<typeof setTimeout>>();
const helperLatestText = new Map<string, string>();
const editUpdateSeq = new Map<string, number>();

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

function inputPeerFromStored(peer?: { peer_id: number; access_hash: string | null }): InstanceType<typeof Api.InputPeerUser> | undefined {
  if (!peer?.access_hash) return undefined;
  return new Api.InputPeerUser({
    userId: bigInt(peer.peer_id),
    accessHash: bigInt(peer.access_hash),
  });
}

async function retrySendTarget<T>(
  peer: { device_id: string; peer_id: number; username: string | null; access_hash: string | null } | undefined,
  send: (target: any) => Promise<T>,
  refreshPeer: (username: string) => Promise<void>,
): Promise<T> {
  const byStoredInput = inputPeerFromStored(peer);
  if (byStoredInput) {
    try {
      return await send(byStoredInput);
    } catch {
      // The stored access hash may be stale; fall through to username refresh when possible.
    }
  }
  if (peer?.username) {
    await refreshPeer(peer.username);
    return send(peer.username);
  }
  throw new Error("cannot resolve telegram peer");
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

type ExtractedAgentPayloads = { text: string; payloads: AgentPayload[] };

function cleanAgentVisibleText(text: string): string {
  let cleaned = text.replace(/\r\n?/g, "\n").trim();

  // Some agents expose skill/tool progress in the user-visible Telegram message, e.g.
  // "진행 상황 ... skilldocs 시작 ... summarize 완료 – Transcript: ...".
  // Keep the useful result and remove the operational prefix from the chat bubble.
  const transcriptIdx = cleaned.lastIndexOf("Transcript:");
  if (transcriptIdx >= 0) cleaned = cleaned.slice(transcriptIdx + "Transcript:".length).trim();

  cleaned = cleaned
    .replace(/(?:^|\n)\s*진행 상황[^\n]*(?=\n|$)/gi, "\n")
    .replace(/(?:^|\n)\s*(?:🛠|💻)?\s*skilldocs\s+(?:시작|완료)\s*[–-]\s*(?:\{[^\n]*\}|[^\n]*)/gi, "\n")
    .replace(/(?:^|\n)\s*(?:🛠|💻)?\s*summarize\s+(?:시작|완료)\s*[–-]\s*(?:\{[^\n]*\}|[^\n]*)/gi, "\n")
    .replace(/\s*>>\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/^확인 중 오류가 발생해 답변을 마무리하지 못했습니다!?\s*$/i.test(cleaned)) return "";
  return cleaned;
}

function inferPayload(raw: Record<string, unknown>): AgentPayload | undefined {
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return undefined;
  if (typeof raw.status === "string") return { type: "task_update", task: raw };
  if (typeof raw.kind === "string" && typeof raw.content === "string") return { type: "artifact", artifact: raw };
  if (Array.isArray(raw.fields) && typeof raw.submitLabel === "string") return { type: "form", form: raw };
  return undefined;
}

function payloadFromBlock(kind: string, json: string): AgentPayload | undefined {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (kind === "agent_task") return { type: "task_update", task: raw };
    if (kind === "agent_artifact") return { type: "artifact", artifact: raw };
    if (kind === "agent_form") return { type: "form", form: raw };
    if (raw.type === "task_update" && raw.task && typeof raw.task === "object") {
      return { type: "task_update", task: raw.task as Record<string, unknown> };
    }
    if (raw.type === "artifact" && raw.artifact && typeof raw.artifact === "object") {
      return { type: "artifact", artifact: raw.artifact as Record<string, unknown> };
    }
    if (raw.type === "form" && raw.form && typeof raw.form === "object") {
      return { type: "form", form: raw.form as Record<string, unknown> };
    }
    if (kind === "json" || kind === "") return inferPayload(raw);
  } catch {
    return undefined;
  }
  return undefined;
}

function extractAgentPayloads(text: string): ExtractedAgentPayloads {
  const payloads: AgentPayload[] = [];
  const cleaned = text.replace(
    /```([A-Za-z0-9_-]*)\s*\n([\s\S]*?)\n```/g,
    (_full, kind: string, json: string) => {
      const payload = payloadFromBlock(kind, json);
      if (payload) payloads.push(payload);
      return payload ? "" : _full;
    },
  ).replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, payloads };
}

type MediaDescriptor = { kind: string; name: string; mime: string; size?: number };

function helperEligibleText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;
  if (/^[.…·\-\s]+$/.test(trimmed)) return false;
  if (/^📚\s*skill_view:/i.test(trimmed)) return false;
  if (/^(?:진행 상황|🛠|💻|Transcript:)/i.test(trimmed)) return false;
  if (!looksCompleteForHelper(trimmed)) return false;
  return true;
}

function looksCompleteForHelper(text: string): boolean {
  const trimmed = text.trim();
  const lastLine = (trimmed.split("\n").filter((line) => line.trim()).pop() ?? trimmed).trim();
  if (/[.!?。！？…]$/.test(lastLine)) return true;
  if (/[)\]}"'”’]$/.test(lastLine) && /[.!?。！？…][)\]}"'”’]*$/.test(lastLine)) return true;
  if (/(?:습니다|합니다|입니다|됩니다|해주세요|주세요|해요|이에요|예요|네요|군요|죠|까요|됩니다|완료했습니다|정리했습니다)$/.test(lastLine)) return true;
  if (/^(```|---|\*\s+\S|-\s+\S|\d+[.)]\s+\S)/m.test(trimmed) && trimmed.length > 600) return true;
  if (trimmed.length >= 1200 && /(?:다|요|죠|함|됨|음)$/.test(lastLine)) return true;
  return false;
}

function nextEditUpdateId(deviceId: string, peerId: number, messageId: number): number {
  const key = `${deviceId}:${peerId}:${messageId}`;
  const next = Math.min((editUpdateSeq.get(key) ?? 1) + 1, 998);
  editUpdateSeq.set(key, next);
  return messageId * 1000 + next;
}

function scheduleHelper(params: {
  deviceId: string;
  peerId: number;
  baseUpdateId: number;
  messageId: number;
  messageDate: number;
  peerTitle: string;
  text: string;
}) {
  const key = `${params.deviceId}:${params.peerId}`;
  const latestKey = `${params.deviceId}:${params.peerId}:${params.messageId}`;
  helperLatestText.set(latestKey, params.text);
  const existing = helperTimers.get(key);
  if (existing) clearTimeout(existing);
  if (!helperEligibleText(params.text)) {
    helperTimers.delete(key);
    return;
  }
  helperTimers.set(
    key,
    setTimeout(() => {
      helperTimers.delete(key);
      void (async () => {
        const latest = helperLatestText.get(latestKey);
        if (latest !== params.text || !helperEligibleText(latest ?? "")) return;
        const recent = store.pullUpdates(params.peerId, Math.max(0, params.baseUpdateId - 5000), 5)
          .map((u) => u.message?.text)
          .filter((x): x is string => !!x);
        const helperItems = await suggestHelperItems({
          buddyTitle: params.peerTitle,
          agentText: params.text,
          recentMessages: recent,
        });
        if (!helperItems.length) return;
        store.insertUpdate(params.peerId, {
          update_id: params.baseUpdateId + 999,
          message: {
            message_id: params.messageId,
            date: params.messageDate,
            chat: { id: params.peerId, type: "private" },
            from: { id: params.peerId, is_bot: true, first_name: params.peerTitle },
            helper_items: helperItems,
          },
        });
      })().catch((e) => log.warn(`helper async insert failed: ${rpcError(e)}`));
    }, 14000),
  );
}

function cancelHelper(deviceId: string, peerId: number) {
  const key = `${deviceId}:${peerId}`;
  const existing = helperTimers.get(key);
  if (existing) clearTimeout(existing);
  helperTimers.delete(key);
}

function buttonStyle(label: string): InlineKeyboardButton["style"] {
  if (/삭제|취소|거절|중단|실패|delete|cancel|reject|stop/i.test(label)) return "danger";
  if (/확인|승인|완료|저장|선택|ok|confirm|approve|save|done/i.test(label)) return "success";
  return "default";
}

function inlineButtonFromMtproto(button: any, row: number, col: number): InlineKeyboardButton {
  const label = String(button.text ?? "").trim() || "버튼";
  const id = `r${row}c${col}`;
  const className = String(button.className ?? "");
  if (className === "KeyboardButtonCallback") return { id, label, type: "callback", style: buttonStyle(label) };
  if (className === "KeyboardButtonUrl") return { id, label, type: "url", url: String(button.url ?? ""), style: "primary" };
  if (className === "KeyboardButtonWebView" || className === "KeyboardButtonSimpleWebView") {
    return { id, label, type: "web_app", url: String(button.url ?? ""), style: "primary" };
  }
  if (className === "KeyboardButtonUrlAuth") return { id, label, type: "login_url", url: String(button.url ?? ""), style: "primary" };
  if (className === "KeyboardButtonSwitchInline") return { id, label, type: "switch_inline", disabled: true };
  if (className === "KeyboardButtonCopy") return { id, label, type: "copy", copyText: String(button.copyText ?? label), style: "default" };
  return { id, label, type: "unsupported", disabled: true };
}

function extractInlineKeyboard(markup: any): InlineKeyboard | undefined {
  if (!markup || String(markup.className ?? "") !== "ReplyInlineMarkup" || !Array.isArray(markup.rows)) return undefined;
  const rows = markup.rows
    .map((row: any, ri: number) => Array.isArray(row.buttons) ? row.buttons.map((b: any, ci: number) => inlineButtonFromMtproto(b, ri, ci)) : [])
    .filter((row: InlineKeyboardButton[]) => row.length > 0);
  return rows.length ? { rows } : undefined;
}

function updateFromTelegramMessage(params: {
  deviceId: string;
  peer: { peer_id: number; title: string | null };
  msg: any;
  edited?: boolean;
}): TgUpdate | null {
  const { deviceId, peer, msg } = params;
  const outgoing = !!msg.out;
  const peerId = peer.peer_id;
  const rawText: string = entitiesToMarkdown(msg.message ?? "", msg.entities as MdEntity[] | undefined);
  const visibleText = !outgoing ? cleanAgentVisibleText(rawText) : rawText;
  const extracted = !outgoing ? extractAgentPayloads(visibleText) : { text: visibleText, payloads: [] };
  const text = extracted.text;
  const mediaInfo = classifyMedia(msg);
  const inlineKeyboard = extractInlineKeyboard(msg.replyMarkup);
  if (!text && !mediaInfo && extracted.payloads.length === 0 && !inlineKeyboard) return null;

  const messageId = Number(msg.id);
  let preview: LinkPreview | undefined;
  const wp = (msg as { media?: { webpage?: any } }).media?.webpage;
  if (wp && wp.className === "WebPage" && wp.url) {
    preview = {
      url: String(wp.url),
      title: wp.title ? String(wp.title) : undefined,
      description: wp.description ? String(wp.description) : undefined,
      siteName: wp.siteName ? String(wp.siteName) : undefined,
      image: wp.photo
        ? `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${messageId}`
        : undefined,
    };
  }
  const media = mediaInfo
    ? { ...mediaInfo, url: `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${messageId}` }
    : undefined;
  const baseUpdateId = messageId * 1000;
  const eventUpdateId = params.edited ? nextEditUpdateId(deviceId, peerId, messageId) : baseUpdateId;
  return {
    update_id: eventUpdateId,
    message: {
      message_id: messageId,
      date: Number(msg.date),
      text,
      chat: { id: peerId, type: "private" },
      from: { id: peerId, is_bot: !outgoing, first_name: peer.title ?? "" },
      outgoing,
      ...(preview ? { preview } : {}),
      ...(media ? { media } : {}),
      ...(extracted.payloads.length ? { agent_payload: extracted.payloads[0], agent_payloads: extracted.payloads } : {}),
      inline_keyboard: inlineKeyboard ?? null,
    },
  };
}

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
  const handleMessageEvent = async (event: unknown, edited: boolean) => {
    try {
      const msg = (event as { message?: any }).message;
      if (!msg) return;
      const outgoing = !!msg.out; // true = the user sent it (possibly from another client)
      // In a private chat, chatId is the peer (the bot) for BOTH directions; senderId is
      // the bot (incoming) or self (outgoing), so always key on chatId.
      const peerId = idToNum(msg.chatId ?? msg.senderId);
      if (!peerId) return;
      const peer = store.getAccountPeer(deviceId, peerId);
      if (!peer) return; // not a subscribed peer — ignore
      const update = updateFromTelegramMessage({ deviceId, peer, msg, edited });
      if (!update?.message) return;
      const updateId = update.message.message_id;
      const baseUpdateId = updateId * 1000;
      const text = update.message.text ?? "";
      const inlineKeyboard = update.message.inline_keyboard ?? undefined;
      store.insertUpdate(peerId, update);
      if (!outgoing && inlineKeyboard) {
        cancelHelper(deviceId, peerId);
      } else if (!outgoing && text.trim()) {
        scheduleHelper({
          deviceId,
          peerId,
          baseUpdateId,
          messageId: updateId,
          messageDate: Number(msg.date),
          peerTitle: peer.title ?? "Agent",
          text,
        });
      }
      // Only push for the bot's replies — never notify the user about their own messages.
      if (!outgoing && !edited && helperEligibleText(text)) {
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
  };
  client.addEventHandler((event: unknown) => handleMessageEvent(event, false), new NewMessage({}));
  client.addEventHandler((event: unknown) => handleMessageEvent(event, true), new EditedMessage({}));
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

  async clickInlineButton(
    deviceId: string,
    peerId: number,
    messageId: number,
    buttonId: string,
  ): Promise<{ message?: string; alert?: boolean; url?: string }> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const match = /^r(\d+)c(\d+)$/.exec(buttonId);
    if (!match) throw new Error("bad button id");
    const row = Number(match[1]);
    const col = Number(match[2]);
    const peer = store.getPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const messages = (await client.getMessages(target, { ids: [messageId] })) as unknown as Array<any>;
    const msg = messages?.[0];
    if (!msg) throw new Error("message not found");
    const keyboard = extractInlineKeyboard(msg.replyMarkup);
    const button = keyboard?.rows[row]?.[col];
    if (!button || button.type !== "callback") throw new Error("not a callback button");
    const result = await msg.click({ i: row, j: col }) as unknown;
    const answer = result as { message?: string; alert?: boolean; url?: string };
    return {
      message: answer?.message ? String(answer.message) : undefined,
      alert: !!answer?.alert,
      url: answer?.url ? String(answer.url) : undefined,
    };
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
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const opts = replyTo ? { message: text, replyTo } : { message: text };
    try {
      const sent = (await client.sendMessage(target, opts)) as { id: number };
      return Number(sent.id);
    } catch (e) {
      const sent = (await retrySendTarget(
        peer,
        (retryTarget) => client.sendMessage(retryTarget, opts),
        async (username) => { await this.resolvePeer(deviceId, username); },
      )) as { id: number };
      return Number(sent.id);
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
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const { buffer, fileName, mime, kind, caption } = opts;
    const file = new CustomFile(fileName, buffer.length, "", buffer);
    const send = (retryTarget: any) => client.sendFile(retryTarget, {
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
      });
    let sent: { id: number };
    try {
      sent = (await send(target)) as { id: number };
    } catch {
      sent = (await retrySendTarget(
        peer,
        send,
        async (username) => { await this.resolvePeer(deviceId, username); },
      )) as { id: number };
    }
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
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const allDocs = items.every((i) => i.kind === "document");
    const files = items.map((i) => new CustomFile(i.fileName, i.buffer.length, "", i.buffer));
    const send = (retryTarget: any) => client.sendFile(retryTarget, {
      file: files, // array → grouped album (one bubble in Telegram clients)
      caption,
      forceDocument: allDocs || undefined,
    });
    let sent: { id: number } | { id: number }[];
    try {
      sent = (await send(target)) as { id: number } | { id: number }[];
    } catch {
      sent = (await retrySendTarget(
        peer,
        send,
        async (username) => { await this.resolvePeer(deviceId, username); },
      )) as { id: number } | { id: number }[];
    }
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

  async syncMessages(
    deviceId: string,
    peerId: number,
    opts: { sinceUpdateId?: number; limit?: number } = {},
  ): Promise<TgUpdate[]> {
    const client = clients.get(deviceId);
    if (!client) throw new Error("not signed in");
    const peer = store.getAccountPeer(deviceId, peerId);
    if (!peer) throw new Error("peer not found");
    const target: string | number = peer.username ? peer.username : peerId;
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const minMessageId = Math.max(0, Math.floor((opts.sinceUpdateId ?? 0) / 1000));
    const request: Record<string, unknown> = { limit };
    if (minMessageId > 0) request.minId = minMessageId;
    const messages = (await client.getMessages(target, request as never)) as unknown as Array<any>;
    const updates = messages
      .map((msg) => updateFromTelegramMessage({ deviceId, peer, msg }))
      .filter((u): u is TgUpdate => !!u && u.update_id >= (opts.sinceUpdateId ?? 0))
      .sort((a, b) => a.update_id - b.update_id);
    for (const update of updates) store.insertUpdate(peerId, update);
    return updates;
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
