import type { Message } from '@/domain/entities/Message';

const HELPER_SUBMIT_BLOCK_RE = /```+\s*agent_helper_response\b[\s\S]*?```+/i;

export function isHelperSubmitContextText(text: string): boolean {
  if (!text) return false;
  if (HELPER_SUBMIT_BLOCK_RE.test(text)) return true;
  if (!/agent_helper_response/i.test(text)) return false;
  return /사용자가 아래 후속 액션|helperItemId|helperType|source/i.test(text);
}

export function isHiddenHelperSubmitMessage(message: Pick<Message, 'role' | 'text'>): boolean {
  return message.role === 'user' && isHelperSubmitContextText(message.text);
}
