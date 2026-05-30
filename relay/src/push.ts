/**
 * Expo push fan-out (APNs/FCM via Expo — no certs to manage). Batches ≤100,
 * checks receipts, prunes tokens Expo reports as DeviceNotRegistered.
 */
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { store } from "./store.js";
import { log } from "./log.js";
import type { TgMessage } from "./types.js";

const expo = new Expo();

export type PushItem = { expoPushToken: string; botTitle: string; m: TgMessage; updateId: number; buddyId: string };

export async function sendPushes(items: PushItem[]): Promise<void> {
  const messages: ExpoPushMessage[] = [];
  for (const it of items) {
    if (!Expo.isExpoPushToken(it.expoPushToken)) {
      log.warn("invalid expo push token, dropping device");
      store.removePushToken(it.expoPushToken);
      continue;
    }
    const text = it.m.text ?? "";
    messages.push({
      to: it.expoPushToken,
      title: it.botTitle,
      body: text.length > 120 ? text.slice(0, 117) + "…" : text, // preview included
      sound: "default",
      priority: "high",
      data: { buddyId: it.buddyId, updateId: it.updateId, chatId: it.m.chat.id },
    });
  }
  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  for (const chunk of chunks) {
    try {
      const res = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...res);
    } catch (e) {
      log.error("expo send failed:", e);
    }
  }

  // Immediate error tickets → prune dead tokens.
  tickets.forEach((t, i) => {
    if (t.status === "error") {
      const detail = t.details?.error;
      log.warn("push ticket error:", detail ?? t.message);
      if (detail === "DeviceNotRegistered") {
        const to = messages[i]?.to;
        if (typeof to === "string") store.removePushToken(to);
      }
    }
  });
}
