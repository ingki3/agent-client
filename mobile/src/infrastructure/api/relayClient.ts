/**
 * Relay REST client (base = config.relayBase).
 *
 * Two roles:
 *  - Push relay: register peers/bots, pull buffered updates, unregister.
 *  - MTProto (user-account) gateway: the relay holds the user's Telegram session, so the
 *    app drives login (phone → code → 2FA), resolves peers (@username), and sends messages
 *    AS THE USER via the relay. Auth is the device-secret minted on the first /auth/start.
 *
 * No-ops (null/empty) when no relay is configured.
 */
import { config } from "../config";
import { secureStore, SecureKeys } from "../storage/secureStore";
import { uid } from "@/lib/id";
import type { TgUpdate } from "./telegramBotApi";
import type { FormValue, HelperItem, InlineKeyboard, LinkPreview, TtsMode } from "@/domain/entities";

// botToken is optional: MTProto peers register with no token (the relay's user-account
// client receives for them — no per-bot getUpdates loop).
export type RelayBot = { buddyId: string; botToken?: string; botId: number };

export type ResolvedPeer = { peerId: number; username: string; title: string };
export type StoredPeer = {
  peerId: number;
  username: string;
  title: string;
  createdAt?: number;
  lastUsedAt?: number;
};

export type AuthResult =
  | { ok: true; needsCode?: boolean; signedIn?: boolean; needs2fa?: boolean; tgUserId?: number }
  | { ok: false; error: string; retryAfter?: number };

export type AuthStatus = {
  status: "none" | "pending" | "active" | "revoked";
  connected: boolean;
  tgUserId?: number;
  phone?: string;
};

export type TtsAudioResult = {
  audioUrl: string;
  script: string;
  mode: TtsMode;
  cacheKey: string;
  generated?: boolean;
};

export type InlineKeyboardCallbackResult = {
  message?: string;
  alert?: boolean;
  url?: string;
};

export type RelayMessageSnapshot = {
  id: string;
  peerId: number;
  messageId: number;
  role: "user" | "agent";
  text: string;
  status: "streaming" | "complete";
  date: number;
  updatedAt: number;
  cursor: number;
  preview?: LinkPreview;
  media?: { kind: string; name: string; mime: string; size?: number; url: string };
  helperItems?: HelperItem[];
  inlineKeyboard?: InlineKeyboard | null;
};

export type RelaySnapshotSyncResult = {
  messages: RelayMessageSnapshot[];
  cursor: number;
};

export type RelayMessageStreamEvent =
  | { type: "connected"; peerId: number; cursor: number }
  | { type: "message_updated"; message: RelayMessageSnapshot }
  | { type: "helper_updated"; message: RelayMessageSnapshot }
  | { type: "error"; message: string };

export type RelayStreamHandle = { close: () => void };

const RELAY_REQUEST_TIMEOUT_MS = 15_000;
const RELAY_TTS_REQUEST_TIMEOUT_MS = 120_000;

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function deviceId(): Promise<string> {
  let id = await secureStore.get(SecureKeys.deviceId);
  if (!id) {
    id = uid("dev");
    await secureStore.set(SecureKeys.deviceId, id);
  }
  return id;
}

async function authHeader(): Promise<Record<string, string>> {
  const secret = await secureStore.get(SecureKeys.deviceSecret);
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

async function postJson(
  path: string,
  body: unknown,
  timeoutMs = RELAY_REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  if (!config.relayBase) return null;
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    const res = await withTimeout(
      (signal) =>
        fetch(`${config.relayBase}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        }),
      timeoutMs,
    );
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  if (!config.relayBase) return null;
  try {
    const headers = { ...(await authHeader()) };
    const res = await withTimeout((signal) =>
      fetch(`${config.relayBase}${path}`, {
        headers,
        signal,
      }),
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function absoluteRelayUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return config.relayBase ? `${config.relayBase}${url}` : url;
}

function normalizeRelayUpdates(updates: TgUpdate[]): TgUpdate[] {
  return updates.map((update) => {
    const message = update.message ?? update.edited_message;
    if (!message) return update;
    const normalized = { ...message };
    if (normalized.preview?.image) {
      const image = absoluteRelayUrl(normalized.preview.image);
      normalized.preview = image ? { ...normalized.preview, image } : { ...normalized.preview };
    }
    if (normalized.media?.url) {
      normalized.media = { ...normalized.media, url: absoluteRelayUrl(normalized.media.url) ?? normalized.media.url };
    }
    return update.message
      ? { ...update, message: normalized }
      : { ...update, edited_message: normalized };
  });
}

function normalizeRelaySnapshots(messages: RelayMessageSnapshot[]): RelayMessageSnapshot[] {
  return messages.map((message) => {
    const normalized = { ...message };
    if (normalized.preview?.image) {
      const image = absoluteRelayUrl(normalized.preview.image);
      normalized.preview = image ? { ...normalized.preview, image } : { ...normalized.preview };
    }
    if (normalized.media?.url) {
      normalized.media = { ...normalized.media, url: absoluteRelayUrl(normalized.media.url) ?? normalized.media.url };
    }
    return normalized;
  });
}

export const relayClient = {
  async health(): Promise<boolean> {
    const body = await getJson("/health");
    return !!body?.ok;
  },

  /** Register device + peers/bots. Persists the returned deviceSecret on first call. */
  async register(expoPushToken: string, bots: RelayBot[]): Promise<boolean> {
    if (!config.relayBase || bots.length === 0) return false;
    const id = await deviceId();
    const res = await fetch(`${config.relayBase}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ deviceId: id, expoPushToken, platform: "ios", gateway: config.gateway, bots }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok: boolean; deviceSecret?: string };
    if (body.deviceSecret) await secureStore.set(SecureKeys.deviceSecret, body.deviceSecret);
    return body.ok;
  },

  async unregister(botId?: number): Promise<void> {
    if (!config.relayBase) return;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return;
    try {
      await fetch(`${config.relayBase}/unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ deviceId: id, ...(botId != null ? { botId } : {}) }),
      });
    } catch {
      // best-effort
    }
  },

  /** Pull buffered updates since a cursor. Shape mirrors Telegram getUpdates. */
  async pull(botId: number, since: number): Promise<TgUpdate[]> {
    if (!config.relayBase) return [];
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return [];
    const res = await fetch(
      `${config.relayBase}/pull?deviceId=${encodeURIComponent(id)}&botId=${botId}&since=${since}`,
      { headers: { ...(await authHeader()) } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { ok: boolean; updates?: TgUpdate[] };
    return body.ok && body.updates ? normalizeRelayUpdates(body.updates) : [];
  },

  async linkPreview(url: string): Promise<LinkPreview | null> {
    if (!config.relayBase) return null;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return null;
    const body = await postJson("/link/preview", { deviceId: id, url });
    if (!body?.ok || !body.preview || typeof body.preview !== "object") return null;
    return body.preview as LinkPreview;
  },

  async createTtsAudio(payload: { messageId: string; text: string; mode: TtsMode; voice?: string }): Promise<TtsAudioResult | null> {
    if (!config.relayBase) return null;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return null;
    const body = await postJson("/tts/audio", { deviceId: id, ...payload }, RELAY_TTS_REQUEST_TIMEOUT_MS);
    if (!body?.ok || typeof body.audioUrl !== "string" || typeof body.script !== "string") return null;
    const audioUrl = body.audioUrl.startsWith("http")
      ? body.audioUrl
      : `${config.relayBase}${body.audioUrl}`;
    return {
      audioUrl,
      script: body.script,
      mode: (body.mode === "brief" || body.mode === "explain" || body.mode === "action_items" ? body.mode : payload.mode) as TtsMode,
      cacheKey: String(body.cacheKey ?? ""),
      generated: !!body.generated,
    };
  },

  // ─── MTProto (user-account) ────────────────────────────────────────────────
  /** Step 1: request a login code for `phone`. Mints + persists the deviceSecret. */
  async authStart(phone: string): Promise<AuthResult> {
    if (!config.relayBase) return { ok: false, error: "no_relay" };
    const id = await deviceId();
    const body = await postJson("/auth/start", { deviceId: id, phone });
    if (!body) return { ok: false, error: "network" };
    if (body.deviceSecret) await secureStore.set(SecureKeys.deviceSecret, body.deviceSecret as string);
    if (!body.ok) return { ok: false, error: String(body.error ?? "unknown"), retryAfter: body.retryAfter as number };
    return { ok: true, needsCode: true };
  },

  /** Step 2: submit the login code. */
  async authCode(code: string): Promise<AuthResult> {
    const id = await deviceId();
    const body = await postJson("/auth/code", { deviceId: id, code });
    if (!body) return { ok: false, error: "network" };
    if (!body.ok) return { ok: false, error: String(body.error ?? "unknown"), retryAfter: body.retryAfter as number };
    return { ok: true, signedIn: !!body.signedIn, needs2fa: !!body.needs2fa, tgUserId: body.tgUserId as number };
  },

  /** Step 3 (optional): submit the 2FA cloud password. */
  async auth2fa(password: string): Promise<AuthResult> {
    const id = await deviceId();
    const body = await postJson("/auth/2fa", { deviceId: id, password });
    if (!body) return { ok: false, error: "network" };
    if (!body.ok) return { ok: false, error: String(body.error ?? "unknown") };
    return { ok: true, signedIn: true, tgUserId: body.tgUserId as number };
  },

  async authLogout(): Promise<void> {
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return;
    await postJson("/auth/logout", { deviceId: id });
  },

  async authStatus(): Promise<AuthStatus | null> {
    if (!config.relayBase) return null;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return null;
    try {
      const res = await fetch(`${config.relayBase}/auth/status?deviceId=${encodeURIComponent(id)}`, {
        headers: { ...(await authHeader()) },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ok: boolean } & AuthStatus;
      return body.ok ? body : null;
    } catch {
      return null;
    }
  },

  /** Resolve a @username to a peer (cached on the relay for sending). */
  async resolvePeer(username: string): Promise<ResolvedPeer> {
    const id = await deviceId();
    const body = await postJson("/peers/resolve", { deviceId: id, username });
    if (!body) throw new Error("network");
    if (!body.ok) throw new Error(String(body.error ?? "resolve_failed"));
    return body.peer as ResolvedPeer;
  },

  async listPeers(): Promise<StoredPeer[]> {
    if (!config.relayBase) return [];
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return [];
    const body = await getJson(`/peers/list?deviceId=${encodeURIComponent(id)}`);
    if (!body?.ok || !Array.isArray(body.peers)) return [];
    return body.peers
      .map((peer) => {
        const p = peer as Record<string, unknown>;
        const peerId = Number(p.peerId);
        if (!Number.isFinite(peerId)) return null;
        const item: StoredPeer = {
          peerId,
          username: typeof p.username === "string" ? p.username : "",
          title: typeof p.title === "string" ? p.title : String(peerId),
        };
        if (typeof p.createdAt === "number") item.createdAt = p.createdAt;
        if (typeof p.lastUsedAt === "number") item.lastUsedAt = p.lastUsedAt;
        return item;
      })
      .filter((peer): peer is StoredPeer => peer !== null);
  },

  async removePeer(peerId: number): Promise<boolean> {
    if (!config.relayBase || !Number.isFinite(peerId)) return false;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return false;
    const body = await postJson("/peers/remove", { deviceId: id, peerId });
    return !!body?.ok;
  },

  async syncMessages(peerId: number, sinceUpdateId = 0, limit = 50): Promise<TgUpdate[]> {
    if (!config.relayBase || !Number.isFinite(peerId)) return [];
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return [];
    const body = await postJson("/messages/sync", { deviceId: id, peerId, sinceUpdateId, limit });
    if (!body?.ok || !Array.isArray(body.updates)) return [];
    return normalizeRelayUpdates(body.updates as TgUpdate[]);
  },

  async syncMessageSnapshots(peerId: number, sinceCursor = 0, limit = 50): Promise<RelaySnapshotSyncResult> {
    if (!config.relayBase || !Number.isFinite(peerId)) return { messages: [], cursor: sinceCursor };
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return { messages: [], cursor: sinceCursor };
    const body = await postJson("/messages/sync", { deviceId: id, peerId, sinceCursor, limit });
    if (!body?.ok || !Array.isArray(body.messages)) return { messages: [], cursor: sinceCursor };
    return {
      messages: normalizeRelaySnapshots(body.messages as RelayMessageSnapshot[]),
      cursor: typeof body.cursor === "number" ? body.cursor : sinceCursor,
    };
  },

  async openMessageStream(
    peerId: number,
    sinceCursor: number,
    onEvent: (event: RelayMessageStreamEvent) => void,
  ): Promise<RelayStreamHandle | null> {
    if (!config.relayBase || !Number.isFinite(peerId)) return null;
    const id = await secureStore.get(SecureKeys.deviceId);
    if (!id) return null;
    const headers = await authHeader();
    const xhr = new XMLHttpRequest();
    let lastIndex = 0;
    let closed = false;
    const url = `${config.relayBase}/messages/stream?deviceId=${encodeURIComponent(id)}&peerId=${peerId}&since=${sinceCursor}`;
    xhr.open("GET", url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader("Accept", "text/event-stream");

    const flush = () => {
      const text = xhr.responseText.slice(lastIndex);
      lastIndex = xhr.responseText.length;
      for (const block of text.split("\n\n")) {
        if (!block.trim() || block.trim().startsWith(":")) continue;
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw) as RelayMessageStreamEvent;
          if ((event.type === "message_updated" || event.type === "helper_updated") && event.message) {
            event.message = normalizeRelaySnapshots([event.message])[0]!;
          }
          onEvent(event);
        } catch {
          onEvent({ type: "error", message: "stream_parse_failed" });
        }
      }
    };

    xhr.onprogress = flush;
    xhr.onload = () => {
      if (!closed) flush();
    };
    xhr.onerror = () => {
      if (!closed) onEvent({ type: "error", message: "stream_error" });
    };
    xhr.send();

    return {
      close: () => {
        closed = true;
        xhr.abort();
      },
    };
  },

  /** Send `text` to `peerId` as the user (optionally as a reply). Returns the sent message id. */
  async sendAs(peerId: number, text: string, clientTag?: string, replyTo?: number): Promise<number> {
    const id = await deviceId();
    const body = await postJson("/send", { deviceId: id, peerId, text, clientTag, replyTo });
    if (!body) throw new Error("network");
    if (!body.ok) throw new Error(String(body.error ?? "send_failed"));
    return body.messageId as number;
  },

  /** Send a base64 file attachment to `peerId` as the user. Returns the sent message id. */
  async sendMedia(
    peerId: number,
    payload: { kind: string; fileName: string; mime: string; caption?: string; dataBase64: string },
  ): Promise<number> {
    const id = await deviceId();
    const body = await postJson("/sendMedia", { deviceId: id, peerId, ...payload });
    if (!body) throw new Error("network");
    if (!body.ok) throw new Error(String(body.error ?? "send_failed"));
    return body.messageId as number;
  },

  /** Send several files as one album to `peerId`. Returns the first message id. */
  async sendMediaGroup(
    peerId: number,
    files: { kind: string; fileName: string; mime: string; dataBase64: string }[],
    caption?: string,
  ): Promise<number> {
    const id = await deviceId();
    const body = await postJson("/sendMediaGroup", { deviceId: id, peerId, caption, files });
    if (!body) throw new Error("network");
    if (!body.ok) throw new Error(String(body.error ?? "send_failed"));
    return body.messageId as number;
  },

  async submitForm(
    peerId: number,
    payload: { formId: string; taskId?: string; status: "submitted" | "cancelled"; values: Record<string, FormValue> },
  ): Promise<boolean> {
    const id = await deviceId();
    const body = await postJson("/form/submit", { deviceId: id, peerId, ...payload });
    return !!body?.ok;
  },

  async submitHelperAction(
    peerId: number,
    payload: {
      helperItemId: string;
      helperType: string;
      action: "submit" | "cancel" | "revise" | "quick_reply" | "save_artifact";
      label?: string;
      value?: string;
      values?: Record<string, FormValue>;
	      source?: {
	        messageId?: number | undefined;
	        text?: string | undefined;
	        excerpt?: string | undefined;
	        urls?: string[] | undefined;
	        handles?: string[] | undefined;
	        preview?: { url?: string | undefined; title?: string | undefined; description?: string | undefined; siteName?: string | undefined } | undefined;
	        attachments?: Array<{ kind?: string | undefined; name?: string | undefined; mime?: string | undefined; size?: number | undefined }> | undefined;
	        recentMessages?: Array<{
	          messageId?: number | undefined;
	          role?: string | undefined;
	          text?: string | undefined;
	          excerpt?: string | undefined;
	          urls?: string[] | undefined;
	          handles?: string[] | undefined;
	          preview?: { url?: string | undefined; title?: string | undefined; description?: string | undefined; siteName?: string | undefined } | undefined;
	          attachments?: Array<{ kind?: string | undefined; name?: string | undefined; mime?: string | undefined; size?: number | undefined }> | undefined;
	        }> | undefined;
	      };
    },
  ): Promise<boolean> {
    const id = await deviceId();
    const body = await postJson("/helper/submit", { deviceId: id, peerId, ...payload });
    return !!body?.ok;
  },

  async clickInlineKeyboardButton(peerId: number, messageId: number, buttonId: string): Promise<InlineKeyboardCallbackResult | null> {
    const id = await deviceId();
    const body = await postJson("/inline-keyboard/callback", { deviceId: id, peerId, messageId, buttonId });
    if (!body?.ok) return null;
    const result = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
    const callback: InlineKeyboardCallbackResult = { alert: !!result.alert };
    if (typeof result.message === "string") callback.message = result.message;
    if (typeof result.url === "string") callback.url = result.url;
    return callback;
  },
};
