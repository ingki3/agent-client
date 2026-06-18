/**
 * listMessages — S-11 진입 시 SQLite 에서 `messages` 를 시간 오름차순으로 가져와
 * `useChatStore` 에 hydrate 한다. (TECH §11.4 `idx_messages_buddy_created`)
 */
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';
import { filterLikelyDuplicateMessages } from '@/domain/messages/duplicateMessages';
import { isHiddenHelperSubmitMessage } from '@/domain/messages/hiddenMessages';

import type { ChatUseCaseDeps } from './types';

export interface ListMessagesInput {
  buddyId: BuddyId;
  /** 최근 N 건만. 기본 200. */
  limit?: number;
}

export function listMessages(
  deps: Pick<ChatUseCaseDeps, 'messagesRepo'>,
  input: ListMessagesInput,
): Message[] {
  const messages = deps.messagesRepo
    .listByBuddy(input.buddyId, input.limit ?? 200)
    .filter((message) => !isHiddenHelperSubmitMessage(message));
  return filterLikelyDuplicateMessages(messages);
}
