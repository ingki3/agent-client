/**
 * Notifications store — Expo push token + permission state. No-op when no relay is
 * configured (pushEnabled=false) or on a simulator (token stays null).
 */
import { create } from "zustand";
import { pushEnabled } from "@/infrastructure/config";
import { pushClient } from "@/infrastructure/notifications/pushClient";
import { commandBridge } from "@/infrastructure/notifications/commandBridge";
import { relayClient, type RelayBot } from "@/infrastructure/api/relayClient";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { useBuddiesStore } from "./buddies-store";

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
  const { buddies, order } = useBuddiesStore.getState();
  return order.flatMap((id) => {
    const buddy = buddies[id];
    const botId = Number(buddy?.id);
    if (!buddy || !Number.isFinite(botId)) return [];
    return [{ buddyId: buddy.id, botId }];
  });
}

export const useNotificationsStore = create<NotifState>((set) => ({
  permission: "undetermined",
  expoPushToken: null,

  enable: async () => {
    if (!pushEnabled()) {
      console.log("[push] enable skipped; relay is not configured.");
      return;
    }
    const token = await pushClient.ensurePermissionAndToken();
    const status = await pushClient.getPermissionStatus();
    set({ expoPushToken: token, permission: token ? "granted" : status });
    if (token) await secureStore.set(SecureKeys.expoPushToken, token);
    const bots = liveBots();
    console.log(`[push] enable resolved permission=${status} token_len=${token?.length ?? 0} bots=${bots.length}`);
    if (bots.length) {
      const fcmToken = await commandBridge.getFcmToken();
      const ok = await relayClient.register(token ?? "", bots, fcmToken ?? undefined);
      await commandBridge.mirrorCredentials();
      console.log(`[push] enable register result=${ok ? "ok" : "failed"} fcm=${fcmToken ? "yes" : "no"}`);
    }
  },

  refresh: async () => {
    if (!pushEnabled()) {
      console.log("[push] refresh skipped; relay is not configured.");
      return;
    }
    const status = await pushClient.getPermissionStatus();
    let token = await secureStore.get(SecureKeys.expoPushToken);
    set({ permission: status, expoPushToken: token });
    console.log(`[push] refresh start permission=${status} cached_token_len=${token?.length ?? 0}`);
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
    console.log(`[push] refresh resolved token_len=${token?.length ?? 0} bots=${bots.length}`);
    if (bots.length) {
      const fcmToken = await commandBridge.getFcmToken();
      const ok = await relayClient.register(token ?? "", bots, fcmToken ?? undefined);
      await commandBridge.mirrorCredentials();
      console.log(`[push] refresh register result=${ok ? "ok" : "failed"} fcm=${fcmToken ? "yes" : "no"}`);
    }
  },
}));
