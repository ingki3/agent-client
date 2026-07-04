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
import { NewMessage } from "telegram/events/index.js";
import { EditedMessage } from "telegram/events/EditedMessage.js";
import { computeCheck } from "telegram/Password.js";
import { CustomFile } from "telegram/client/uploads.js";
import { clientTags } from "./clientTags.js";
import { config } from "./config.js";
import { store } from "./store.js";
import { sendPushes } from "./push.js";
import { log } from "./log.js";
import { helperEligibleText } from "./helper/eligibility.js";
import { cancelHelper, scheduleHelper } from "./helper/scheduler.js";
import { upsertAndPublishSnapshot } from "./snapshot.js";
import { idToNum, newClient, retrySendTarget, rpcError } from "./telegram/client.js";
import { extractInlineKeyboard } from "./telegram/inlineKeyboard.js";
import { normalizeMediaKind, telegramDocumentAttributes, telegramSafeFileName } from "./telegram/mediaPayload.js";
import { updateFromTelegramMessage } from "./telegram/messageNormalizer.js";
import type { TgUpdate } from "./types.js";

type Pending = { client: TelegramClient; phoneCodeHash: string; phone: string };

const clients = new Map<string, TelegramClient>(); // signed-in, live (deviceId → client)

/** Resolve a signed-in client or throw the canonical "not signed in" error. */
function ensureClient(deviceId: string): TelegramClient {
  const client = clients.get(deviceId);
  if (!client) throw new Error("not signed in");
  return client;
}
const pending = new Map<string, Pending>(); // mid-login (deviceId → connected client)

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
      if (outgoing && !edited) {
        const tag = clientTags.matchOutgoing(deviceId, peerId, update.message.text ?? "");
        if (tag) update.message.client_tag = tag;
      }
      const updateId = update.message.message_id;
      const baseUpdateId = updateId * 1000;
      const text = update.message.text ?? "";
      const inlineKeyboard = update.message.inline_keyboard ?? undefined;
      store.insertUpdate(peerId, update);
      upsertAndPublishSnapshot(update);
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
    const client = ensureClient(deviceId);
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
    const client = ensureClient(deviceId);
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
  async sendAs(deviceId: string, peerId: number, text: string, replyTo?: number, clientTag?: string): Promise<number> {
    const client = ensureClient(deviceId);
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const opts = replyTo ? { message: text, replyTo } : { message: text };
    // Register BEFORE the send: the NewMessage echo can arrive before
    // sendMessage resolves, and the echo handler is what stamps the tag.
    if (clientTag) clientTags.register(deviceId, peerId, text, clientTag);
    try {
      const sent = (await client.sendMessage(target, opts)) as { id: number };
      return Number(sent.id);
    } catch (e) {
      try {
        const sent = (await retrySendTarget(
          peer,
          (retryTarget) => client.sendMessage(retryTarget, opts),
          async (username) => { await this.resolvePeer(deviceId, username); },
        )) as { id: number };
        return Number(sent.id);
      } catch (retryErr) {
        if (clientTag) clientTags.discard(clientTag);
        throw retryErr;
      }
    }
  },

  /** Send a file (document/image/video/voice/audio) as the user. Returns the message id. */
  async sendMediaAs(
    deviceId: string,
    peerId: number,
    opts: { buffer: Buffer; fileName: string; mime: string; kind: string; caption?: string },
  ): Promise<number> {
    const client = ensureClient(deviceId);
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const mime = opts.mime || "application/octet-stream";
    const kind = normalizeMediaKind(opts.kind, mime);
    const fileName = telegramSafeFileName(opts.fileName, mime);
    const { buffer, caption } = opts;
    const file = new CustomFile(fileName, buffer.length, "", buffer);
    const send = (retryTarget: any) => client.sendFile(retryTarget, {
        file,
        caption,
        forceDocument: kind === "document" || kind === "audio" || kind === "voice",
        voiceNote: kind === "voice",
        supportsStreaming: kind === "video",
        attributes: telegramDocumentAttributes({ kind, fileName }),
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
    return Number(sent.id);
  },

  /** Send several files as ONE Telegram album (media group). Returns the first message id. */
  async sendMediaGroupAs(
    deviceId: string,
    peerId: number,
    items: { buffer: Buffer; fileName: string; mime: string; kind: string }[],
    caption?: string,
  ): Promise<number> {
    const client = ensureClient(deviceId);
    const peer = store.getAccountPeer(deviceId, peerId);
    const target: string | number = peer?.username ? peer.username : peerId;
    const normalized = items.map((item) => {
      const mime = item.mime || "application/octet-stream";
      const kind = normalizeMediaKind(item.kind, mime);
      const fileName = telegramSafeFileName(item.fileName, mime);
      return { ...item, mime, kind, fileName };
    });
    const allDocuments = normalized.every((i) => i.kind === "document" || i.kind === "audio" || i.kind === "voice");
    const files = normalized.map((i) => new CustomFile(i.fileName, i.buffer.length, "", i.buffer));
    const attributes = normalized.map((item) => telegramDocumentAttributes({ kind: item.kind, fileName: item.fileName }) ?? []);
    const send = (retryTarget: any) => client.sendFile(retryTarget, {
      file: files, // array → grouped album (one bubble in Telegram clients)
      caption,
      forceDocument: allDocuments || undefined,
      attributes,
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
    const client = ensureClient(deviceId);
    const peer = store.getAccountPeer(deviceId, peerId);
    if (!peer) throw new Error("peer not found");
    const target: string | number = peer.username ? peer.username : peerId;
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const minMessageId = Math.max(0, Math.floor((opts.sinceUpdateId ?? 0) / 1000));
    const request: Record<string, unknown> = { limit };
    if (minMessageId > 0) request.minId = minMessageId;
    const messages = (await client.getMessages(target, request as never)) as unknown as Array<any>;
    const historyUpdates = messages
      .map((msg) => updateFromTelegramMessage({ deviceId, peer, msg }))
      .filter((u): u is TgUpdate => !!u && u.update_id >= (opts.sinceUpdateId ?? 0))
      .sort((a, b) => a.update_id - b.update_id);
    const bufferedUpdates = store.pullUpdates(peerId, opts.sinceUpdateId ?? 0, limit);
    const updatesById = new Map<number, TgUpdate>();
    for (const update of bufferedUpdates) updatesById.set(update.update_id, update);
    // Prefer live history for the base update id because it reflects Telegram's current
    // message body; keep buffered edited/progress updates that history cannot represent.
    for (const update of historyUpdates) updatesById.set(update.update_id, update);
    const updates = [...updatesById.values()]
      .sort((a, b) => a.update_id - b.update_id)
      .slice(0, limit);
    for (const update of updates) {
      store.insertUpdate(peerId, update);
      upsertAndPublishSnapshot(update, "message_updated", { publish: false, updateComplete: false });
    }
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
