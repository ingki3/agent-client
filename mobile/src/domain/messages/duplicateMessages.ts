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
 * The single visibility rule for a conversation: hidden helper-submit context
 * messages removed, likely duplicates collapsed. Used by both the hydrate path
 * (listMessages) and the live path (receiveUpdates) so a room never changes
 * contents on re-entry.
 */
export function selectVisibleMessages(messages: Message[]): Message[] {
  return filterLikelyDuplicateMessages(
    messages.filter((message) => !isHiddenHelperSubmitMessage(message)),
  );
}
