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
  let skippedInvalidToken = 0;
  for (const it of items) {
    if (!Expo.isExpoPushToken(it.expoPushToken)) {
      // Empty token = pull-only device (push not granted / simulator); a malformed token
      // can still pull. Do NOT delete the device here — only a real DeviceNotRegistered
      // receipt (below) prunes it. (Deleting on empty token broke relay-pull receive.)
      skippedInvalidToken += 1;
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
    // Silent data-only companion: the display push above is a notification-message,
    // which Android's system tray shows WITHOUT waking the app's JS when it is
    // backgrounded/terminated. This one has no title/body, so it is delivered
    // straight to the app's background notification task, which pre-syncs the
    // room's messages into local storage — opening the chat from the notification
    // then shows the new message instantly. `silent: true` tells the app's
    // foreground handler to never render it.
    messages.push({
      to: it.expoPushToken,
      priority: "high",
      _contentAvailable: true,
      data: { buddyId: it.buddyId, updateId: it.updateId, chatId: it.m.chat.id, silent: true },
    });
  }
  if (messages.length === 0) {
    log.info(`push skipped total=${items.length} invalid_or_empty_token=${skippedInvalidToken}`);
    return;
  }
  log.info(`push sending total=${items.length} messages=${messages.length} invalid_or_empty_token=${skippedInvalidToken}`);

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
  const errors = tickets.filter((t) => t.status === "error").length;
  log.info(`push tickets sent=${tickets.length} errors=${errors}`);
}
