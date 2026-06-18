import type { Message } from '@/domain/entities/Message';

const DUPLICATE_WINDOW_MS = 60_000;

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isLikelyDuplicateMessage(a: Message, b: Message): boolean {
  if (a.buddyId !== b.buddyId) return false;
  if (a.role !== 'agent' || b.role !== 'agent') return false;
  const aText = compactText(a.text);
  const bText = compactText(b.text);
  if (!aText || aText !== bText) return false;
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
