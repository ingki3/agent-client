import type { Message } from '@/domain/entities/Message';
import { isHiddenHelperSubmitMessage } from '@/domain/messages/hiddenMessages';

/**
 * One side lacks a server id: plausibly the same logical message arriving via
 * different paths (optimistic local vs relay echo) — allow a generous window.
 */
const DUPLICATE_WINDOW_MS = 60_000;
/**
 * Both sides carry distinct server ids: two genuinely separate Telegram
 * messages. Bots do re-emit the same answer under a new message_id within a
 * few seconds (edit/re-send bursts), but beyond that identical text is a
 * legitimate repeated reply and must stay visible.
 */
const DISTINCT_ID_WINDOW_MS = 5_000;

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isLikelyDuplicateMessage(a: Message, b: Message): boolean {
  if (a.buddyId !== b.buddyId) return false;
  if (a.role !== 'agent' || b.role !== 'agent') return false;
  const aText = compactText(a.text);
  const bText = compactText(b.text);
  if (!aText || aText !== bText) return false;
  if (a.id && b.id) {
    if (a.id === b.id) return true;
    return Math.abs(a.createdAt - b.createdAt) <= DISTINCT_ID_WINDOW_MS;
  }
  return Math.abs(a.createdAt - b.createdAt) <= DUPLICATE_WINDOW_MS;
}

export function filterLikelyDuplicateMessages(messages: Message[]): Message[] {
  const visible: Message[] = [];
  for (const message of messages) {
    if (visible.some((existing) => isLikelyDuplicateMessage(existing, message))) continue;
    visible.push(message);
  }
  return visible;
}

/**
 * Numeric server sequence for a row, or null when it is a not-yet-confirmed
 * local row. Telegram assigns every message in a conversation (the user's and
 * the agent's alike) a monotonically increasing message_id, so this sequence —
 * not the wall clock — is the true send order. Remote/adopted rows carry it as
 * `id`; a purely local row's `id` is null (in memory) or the non-numeric
 * clientMessageId (once persisted, insert() falls back to it for the PK).
 */
function serverSeq(message: Message): number | null {
  if (message.id == null) return null;
  const n = Number(message.id);
  return Number.isFinite(n) ? n : null;
}

/**
 * Display order comparator.
 *
 * Two confirmed rows are ordered by the server message sequence, NOT by
 * createdAt: createdAt mixes clocks (a remote row carries Telegram's
 * second-precision `date`; an adopted local row keeps the phone's millisecond
 * wall clock), so a createdAt sort inverts a same-second question/reply pair and
 * misorders under phone↔server clock skew. The server sequence has neither
 * failure mode — it is monotonic and single-sourced.
 *
 * A not-yet-confirmed local row (optimistic send, offline queue, a send that
 * failed client-side) has no sequence yet, so it is placed CHRONOLOGICALLY by
 * its createdAt against confirmed rows, at second granularity. A fresh send
 * (createdAt ≈ now) naturally lands at the tail; a stale un-acked send from days
 * ago stays back at its real time instead of masquerading as the newest message
 * at the bottom. On a same-second tie the pending row — the question just asked —
 * sorts before the confirmed reply.
 */
export function compareMessagesForDisplay(a: Message, b: Message): number {
  const sa = serverSeq(a);
  const sb = serverSeq(b);

  // Both confirmed → server sequence (immune to the mixed clocks in createdAt).
  if (sa !== null && sb !== null) {
    if (sa !== sb) return sa - sb;
    return a.clientMessageId.localeCompare(b.clientMessageId);
  }

  // Both pending → creation order.
  if (sa === null && sb === null) {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.clientMessageId.localeCompare(b.clientMessageId);
  }

  // Exactly one pending → place it chronologically (by second) against the
  // confirmed row; tie → the pending question sorts before the confirmed reply.
  const pendingIsA = sa === null;
  const pending = pendingIsA ? a : b;
  const confirmed = pendingIsA ? b : a;
  const pendingSec = Math.floor(pending.createdAt / 1000);
  const confirmedSec = Math.floor(confirmed.createdAt / 1000);
  const order = pendingSec !== confirmedSec ? pendingSec - confirmedSec : -1;
  return pendingIsA ? order : -order;
}

export function sortConversationChronology(messages: Message[]): Message[] {
  return [...messages].sort(compareMessagesForDisplay);
}

/**
 * The single visibility rule for a conversation: hidden helper-submit context
 * messages removed, likely duplicates collapsed, chronologically ordered. Used
 * by both the hydrate path (listMessages) and the live path (receiveUpdates) so
 * a room never changes contents or order on re-entry.
 */
export function selectVisibleMessages(messages: Message[]): Message[] {
  const visible = filterLikelyDuplicateMessages(
    messages.filter((message) => !isHiddenHelperSubmitMessage(message)),
  );
  return sortConversationChronology(visible);
}
