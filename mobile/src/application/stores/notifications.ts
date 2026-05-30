/**
 * Notifications store — Expo push token + permission state. No-op when no relay is
 * configured (pushEnabled=false) or on a simulator (token stays null).
 */
import { create } from "zustand";
import { pushEnabled } from "@/infrastructure/config";
import { pushClient } from "@/infrastructure/notifications/pushClient";
import { relayClient, type RelayBot } from "@/infrastructure/api/relayClient";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { useBuddiesStore } from "./buddies";

type NotifState = {
  permission: "granted" | "denied" | "undetermined" | "unsupported";
  expoPushToken: string | null;
  /** Ensure permission + token, persist it, and (re)register all live buddies. */
  enable: () => Promise<void>;
  /** Refresh permission/token on launch (when already authed). */
  refresh: () => Promise<void>;
};

async function liveBots(): Promise<RelayBot[]> {
  const bots: RelayBot[] = [];
  for (const b of useBuddiesStore.getState().buddies) {
    if (!b.live || b.botId == null) continue;
    const token = await secureStore.get(SecureKeys.botToken(b.id));
    if (token) bots.push({ buddyId: b.id, botToken: token, botId: b.botId });
  }
  return bots;
}

export const useNotificationsStore = create<NotifState>((set, get) => ({
  permission: "undetermined",
  expoPushToken: null,

  enable: async () => {
    if (!pushEnabled) return;
    const token = await pushClient.ensurePermissionAndToken();
    const status = await pushClient.getPermissionStatus();
    set({ expoPushToken: token, permission: token ? "granted" : status });
    if (!token) return;
    await secureStore.set(SecureKeys.expoPushToken, token);
    const bots = await liveBots();
    if (bots.length) await relayClient.register(token, bots);
  },

  refresh: async () => {
    if (!pushEnabled) return;
    const status = await pushClient.getPermissionStatus();
    const stored = await secureStore.get(SecureKeys.expoPushToken);
    set({ permission: status, expoPushToken: stored });
    if (status === "granted") {
      // Re-acquire (token can rotate) and re-register if it changed.
      const token = await pushClient.ensurePermissionAndToken();
      if (token && token !== stored) {
        await secureStore.set(SecureKeys.expoPushToken, token);
        set({ expoPushToken: token });
        const bots = await liveBots();
        if (bots.length) await relayClient.register(token, bots);
      }
    }
  },
}));
