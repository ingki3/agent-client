import { log } from "../log.js";
import { messageStreams } from "../streams.js";
import { store } from "../store.js";
import { suggestHelperItems } from "../helper.js";
import type { TgUpdate } from "../types.js";
import { helperEligibleText } from "./eligibility.js";

const helperTimers = new Map<string, ReturnType<typeof setTimeout>>();
const helperLatestText = new Map<string, string>();
const helperInFlight = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function helperWorkSnapshot() {
  return { pending: helperTimers.size, inFlight: helperInFlight.size };
}

export async function waitForHelperIdle(timeoutMs = 70_000): Promise<{ idle: boolean; waitedMs: number; pending: number; inFlight: number }> {
  const started = Date.now();
  for (;;) {
    const state = helperWorkSnapshot();
    if (state.pending === 0 && state.inFlight === 0) {
      return { idle: true, waitedMs: Date.now() - started, ...state };
    }
    if (Date.now() - started >= timeoutMs) {
      return { idle: false, waitedMs: Date.now() - started, ...state };
    }
    await sleep(250);
  }
}

export function scheduleHelper(params: {
  deviceId: string;
  peerId: number;
  baseUpdateId: number;
  messageId: number;
  messageDate: number;
  peerTitle: string;
  text: string;
}) {
  const key = `${params.peerId}:${params.messageId}`;
  const latestKey = key;
  helperLatestText.set(latestKey, params.text);
  const existing = helperTimers.get(key);
  if (existing) clearTimeout(existing);
  if (!helperEligibleText(params.text)) {
    helperTimers.delete(key);
    log.info(`helper.generate.skipped peer=${params.peerId} msg=${params.messageId} reason=ineligible text_len=${params.text.trim().length}`);
    return;
  }
  helperTimers.set(
    key,
    setTimeout(() => {
      helperTimers.delete(key);
      void (async () => {
        const latest = helperLatestText.get(latestKey);
        if (latest !== params.text || !helperEligibleText(latest ?? "")) return;
        if (helperInFlight.has(key)) {
          log.info(`helper.generate.skipped peer=${params.peerId} msg=${params.messageId} reason=duplicate_inflight`);
          return;
        }
        helperInFlight.add(key);
        try {
          const recent = store.pullUpdates(params.peerId, Math.max(0, params.baseUpdateId - 5000), 5)
            .map((u) => u.message?.text)
            .filter((x): x is string => !!x);
          const helperItems = await suggestHelperItems({
            buddyTitle: params.peerTitle,
            agentText: params.text,
            recentMessages: recent,
          });
          if (!helperItems.length) {
            log.info(`helper.generate.skipped peer=${params.peerId} msg=${params.messageId} reason=no_items text_len=${params.text.length}`);
            return;
          }
          const helperUpdate: TgUpdate = {
            update_id: params.baseUpdateId + 999,
            message: {
              message_id: params.messageId,
              date: params.messageDate,
              chat: { id: params.peerId, type: "private" },
              from: { id: params.peerId, is_bot: true, first_name: params.peerTitle },
              helper_items: helperItems,
            },
          };
          store.insertUpdate(params.peerId, helperUpdate);
          const merged = store.mergeSnapshotHelperItems(params.peerId, params.messageId, helperItems);
          if (merged?.changed) {
            messageStreams.publish(params.peerId, { type: "helper_updated", message: merged.message });
          }
          log.info(`helper.generate.completed peer=${params.peerId} msg=${params.messageId} items=${helperItems.length}`);
        } finally {
          helperInFlight.delete(key);
        }
      })().catch((e) => log.warn(`helper.generate.failed peer=${params.peerId} msg=${params.messageId} error=${(e as { message?: string })?.message ?? String(e)}`));
    }, 14000),
  );
}

export function cancelHelper(_deviceId: string, peerId: number) {
  const prefix = `${peerId}:`;
  for (const [key, timer] of helperTimers.entries()) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    helperTimers.delete(key);
  }
}
