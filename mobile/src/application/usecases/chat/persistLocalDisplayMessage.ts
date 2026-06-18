import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';

import type { ChatUseCaseDeps } from './types';

export interface PersistLocalDisplayMessageInput {
  buddyId: BuddyId;
  role: Message['role'];
  text: string;
  clientMessageId?: string;
  createdAt?: number;
}

export function persistLocalDisplayMessage(
  deps: Pick<ChatUseCaseDeps, 'db' | 'messagesRepo' | 'newClientMessageId' | 'now'>,
  input: PersistLocalDisplayMessageInput,
): Message {
  const text = input.text.trim();
  if (!text) throw new Error('persistLocalDisplayMessage: empty text is not allowed');
  const message: Message = {
    id: null,
    clientMessageId: input.clientMessageId ?? deps.newClientMessageId(),
    buddyId: input.buddyId,
    role: input.role,
    text,
    status: 'sent',
    createdAt: input.createdAt ?? deps.now(),
    traceId: null,
  };
  deps.db.transaction(() => deps.messagesRepo.insert(message));
  return message;
}
