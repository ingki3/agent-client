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

/** Live buddies are resolved peers — no device-side token; the relay's user session
 *  receives for them, so we register just the subscription (buddyId + peer id). */
function liveBots(): RelayBot[] {
  return useBuddiesStore
    .getState()
    .buddies.filter((b): b is typeof b & { botId: number } => b.live && b.botId != null)
    .map((b) => ({ buddyId: b.id, botId: b.botId }));
}

export const useNotificationsStore = create<NotifState>((set) => ({
  permission: "undetermined",
  expoPushToken: null,

  enable: async () => {
    if (!pushEnabled()) return;
    const token = await pushClient.ensurePermissionAndToken();
    const status = await pushClient.getPermissionStatus();
    set({ expoPushToken: token, permission: token ? "granted" : status });
    if (!token) return;
    await secureStore.set(SecureKeys.expoPushToken, token);
    const bots = liveBots();
    if (bots.length) await relayClient.register(token, bots);
  },

  refresh: async () => {
    if (!pushEnabled()) return;
    const status = await pushClient.getPermissionStatus();
    let token = await secureStore.get(SecureKeys.expoPushToken);
    set({ permission: status, expoPushToken: token });
    if (status === "granted") {
      // Re-acquire (token can rotate).
      const fresh = await pushClient.ensurePermissionAndToken();
      if (fresh && fresh !== token) {
        token = fresh;
        await secureStore.set(SecureKeys.expoPushToken, token);
        set({ expoPushToken: token });
      }
    }
    // Self-heal: re-register live buddies every launch (idempotent) so a dropped device /
    // subscription is recreated — required for relay-pull receive to keep working.
    const bots = liveBots();
    if (bots.length) await relayClient.register(token ?? "", bots);
  },
}));
