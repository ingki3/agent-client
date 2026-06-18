/**
 * retryMessage — 명시적 [재전송] 동선 (D-02 길게 누름 → 재전송).
 *
 * sendMessage 의 재시도 변형. 차이점:
 *   - 새 row 를 만들지 않고 기존 clientMessageId 의 status 만 sending → sent/failed 로 전이
 *   - outbox 에 이미 있을 수 있으니 성공 시 명시적 dequeue
 *   - offline 일 경우 status `queued` 로 복귀 + outbox upsert
 */
import type { Message, ServerMessageId } from '@/domain/entities/Message';
import { BotApiError } from '@/domain/rules/BotApiError';

import {
  BuddyNotFoundError,
  type ChatUseCaseDeps,
  MessageNotFoundError,
  MissingBotTokenError,
} from './types';

export interface RetryMessageInput {
  clientMessageId: string;
  isOnline: boolean;
}

export type RetryMessageOutcome =
  | { kind: 'sent'; message: Message; serverMessageId: ServerMessageId }
  | { kind: 'failed'; message: Message; error: unknown; queued: boolean }
  | { kind: 'queued-offline'; message: Message };

export async function retryMessage(
  deps: ChatUseCaseDeps,
  input: RetryMessageInput,
): Promise<RetryMessageOutcome> {
  const stored = deps.messagesRepo.findByClientMessageId(input.clientMessageId);
  if (!stored) throw new MessageNotFoundError(input.clientMessageId);
  const buddy = deps.buddiesRepo.findById(stored.buddyId);
  if (!buddy) throw new BuddyNotFoundError(stored.buddyId);

  // offline → queued + outbox upsert, 즉시 종료.
  if (!input.isOnline) {
    deps.db.transaction(() => {
      deps.messagesRepo.updateStatus(stored.clientMessageId, 'queued');
      deps.outboxRepo.enqueue({
        messageId: stored.clientMessageId,
        buddyId: stored.buddyId,
        text: stored.text,
        retryCount: 0,
        lastError: null,
        enqueuedAt: deps.now(),
      });
    });
    return {
      kind: 'queued-offline',
      message: { ...stored, status: 'queued' },
    };
  }

  // sending 표시. UI 가 즉시 spinner 로 전환.
  deps.messagesRepo.updateStatus(stored.clientMessageId, 'sending');

  let token: string | null = null;
  try {
    token = await deps.tokenStore.load(buddy.id);
  } catch (err) {
    return markFailed(deps, stored, err);
  }
  if (!token) return markFailed(deps, stored, new MissingBotTokenError(buddy.id));

  try {
    const result = await deps.botApi.sendMessage(token, {
      chat_id: buddy.id,
      text: stored.text,
    });
    const serverMessageId = String(result.message_id);
    deps.db.transaction(() => {
      // outbox.message_id has a FOREIGN KEY on messages(id). Remove the queue
      // entry BEFORE updating the messages PK so the FK does not block.
      deps.outboxRepo.remove(stored.clientMessageId);
      deps.messagesRepo.updateServerId(stored.clientMessageId, serverMessageId);
      deps.messagesRepo.updateStatus(stored.clientMessageId, 'sent');
    });
    return {
      kind: 'sent',
      message: { ...stored, id: serverMessageId, status: 'sent' },
      serverMessageId,
    };
  } catch (err) {
    return markFailed(deps, stored, err);
  }
}

function markFailed(
  deps: ChatUseCaseDeps,
  message: Message,
  err: unknown,
): RetryMessageOutcome {
  const recoverable = isRecoverableError(err);
  const lastError = describeError(err);
  deps.db.transaction(() => {
    deps.messagesRepo.updateStatus(message.clientMessageId, 'failed');
    if (recoverable) {
      deps.outboxRepo.enqueue({
        messageId: message.clientMessageId,
        buddyId: message.buddyId,
        text: message.text,
        retryCount: 0,
        lastError,
        enqueuedAt: deps.now(),
      });
    } else {
      deps.outboxRepo.remove(message.clientMessageId);
    }
  });
  return {
    kind: 'failed',
    message: { ...message, status: 'failed' },
    error: err,
    queued: recoverable,
  };
}

function isRecoverableError(err: unknown): boolean {
  if (err instanceof BotApiError) {
    return err.kind === 'network_error' ||
      err.kind === 'server_error' ||
      err.kind === 'rate_limited' ||
      err.kind === 'aborted';
  }
  return !(err instanceof MissingBotTokenError);
}

function describeError(err: unknown): string {
  if (err instanceof BotApiError) {
    return `${err.kind}${err.description ? `: ${err.description}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
