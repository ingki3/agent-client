/**
 * Push relay REST client (base = config.relayBase). The relay is the sole Telegram
 * getUpdates consumer; the app registers bot tokens with it, pulls buffered updates,
 * and unregisters on remove/logout. No-ops (null/empty) when no relay is configured.
 */
import { config } from "../config";
import { secureStore, SecureKeys } from "../storage/secureStore";
import { uid } from "@/lib/id";
import type { TgUpdate } from "./telegramBotApi";

export type RelayBot = { buddyId: string; botToken: string; botId: number };

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

export const relayClient = {
  /** Register device + bot tokens. Persists the returned deviceSecret on first call. */
  async register(expoPushToken: string, bots: RelayBot[]): Promise<boolean> {
    if (!config.relayBase || bots.length === 0) return false;
    const id = await deviceId();
    const res = await fetch(`${config.relayBase}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({
        deviceId: id,
        expoPushToken,
        platform: "ios",
        gateway: config.gateway,
        bots,
      }),
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
};
