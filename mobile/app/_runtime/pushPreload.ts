/**
 * Pre-load pushed messages into local SQLite the moment the push ARRIVES —
 * foreground, background, or terminated — so opening the room from the
 * notification shows the new message instantly (entry hydrate reads it from
 * disk) instead of waiting for the entry backfill's network round-trip.
 *
 * Two delivery paths feed one preload:
 * - expo-notifications background task (registered below) — Android runs it
 *   headless for pushes received while the app is backgrounded or terminated.
 *   The task MUST be defined at module scope of a module loaded by the app
 *   entry (see index.ts) — a headless launch loads the bundle without
 *   rendering any route, so a definition inside a route file never runs.
 * - the foreground received-listener wired in app/_layout.tsx.
 * A per-buddy window dedupes the two when both fire for the same push.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { loadRuntimeConfig } from '@/infrastructure/config';
import type { NotifData } from '@/infrastructure/notifications/pushClient';

import { backfillRecentMessagesFlow, initChatRuntime } from './chat';

const BACKGROUND_NOTIFICATION_TASK = 'chat-message-preload';

const lastPreloadAt: Record<string, number> = {};
const PRELOAD_DEDUPE_MS = 3_000;

export async function preloadMessagesForPush(data: NotifData | null | undefined): Promise<void> {
  const buddyId = data?.buddyId ?? (data?.chatId != null ? String(data.chatId) : null);
  if (!buddyId) return;
  const now = Date.now();
  if (now - (lastPreloadAt[buddyId] ?? 0) < PRELOAD_DEDUPE_MS) return;
  lastPreloadAt[buddyId] = now;
  try {
    // Self-contained bootstrap: a headless runtime starts cold, and all three
    // calls are idempotent when the full app is already running.
    await loadRuntimeConfig();
    initChatRuntime();
    console.log(`[push] preload start buddy=${buddyId}`);
    await backfillRecentMessagesFlow(buddyId);
  } catch (error) {
    // Best-effort: the entry-time backfill still covers the room on open.
    console.warn('[push] preload failed', error);
  }
}

/**
 * The push's custom data across the payload shapes expo-notifications hands a
 * background task: a NotificationResponse (action tap), a remote receipt with
 * direct data fields (foreground/iOS), or Android's headless delivery where
 * the custom data rides in the `dataString` JSON.
 */
function extractNotifData(payload: Notifications.NotificationTaskPayload): NotifData | null {
  if ('actionIdentifier' in payload) {
    return (payload.notification.request.content.data ?? null) as NotifData | null;
  }
  const data = payload.data;
  if (!data) return null;
  if (typeof data.dataString === 'string') {
    try {
      return JSON.parse(data.dataString) as NotifData;
    } catch {
      return null;
    }
  }
  return data as NotifData;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    // Await (don't fire-and-forget): the returned promise is what keeps the
    // headless runtime alive until the backfill has hit the network and disk.
    await preloadMessagesForPush(extractNotifData(data));
  },
);

/** Idempotent; safe to call on every app start once notifications are usable. */
export async function registerPushPreloadTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  } catch (error) {
    // e.g. notifications unavailable (simulator) — foreground preload still works.
    console.warn('[push] preload task registration failed', error);
  }
}
