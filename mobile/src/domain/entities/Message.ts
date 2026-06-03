import type { BuddyId } from './Buddy';

export type MessageRole = 'user' | 'agent' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'queued';

export type ClientMessageId = string;

export type ServerMessageId = string;

export interface Message {
  id: ServerMessageId | null;
  clientMessageId: ClientMessageId;
  buddyId: BuddyId;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  createdAt: number;
  traceId: string | null;
}
