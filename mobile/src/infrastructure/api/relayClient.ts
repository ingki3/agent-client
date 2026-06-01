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

// botToken is optional: MTProto peers register with no token (the relay's user-account
// client receives for them — no per-bot getUpdates loop).
export type RelayBot = { buddyId: string; botToken?: string; botId: number };

export type ResolvedPeer = { peerId: number; username: string; title: string };

export type AuthResult =
  | { ok: true; needsCode?: boolean; signedIn?: boolean; needs2fa?: boolean; tgUserId?: number }
  | { ok: false; error: string; retryAfter?: number };

export type AuthStatus = {
  status: "none" | "pending" | "active" | "revoked";
  connected: boolean;
  tgUserId?: number;
  phone?: string;
};

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

async function postJson(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!config.relayBase) return null;
  try {
    const res = await fetch(`${config.relayBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const relayClient = {
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
    return body.ok && body.updates ? body.updates : [];
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
};
