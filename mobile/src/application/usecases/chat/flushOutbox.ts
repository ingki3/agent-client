/**
 * flushOutbox — 네트워크 복귀 시 `outbox` 큐를 BFS 순서로 자동 재전송한다 (TECH §3.4).
 *
 * 정책:
 *   - `enqueued_at` 오름차순 (FIFO) — `outbox-repo.listOldestFirst()`
 *   - 메시지당 지수 백오프: `baseDelayMs * 2^retryCount`. 호출자 (composition root)
 *     가 setTimeout 으로 wrap. 본 함수는 단일 패스만 수행 (재귀 없음).
 *   - 최대 재시도 횟수 (`maxRetries`) 도달 시 status `failed` 로 확정 + outbox 제거.
 *
 * 반환값은 caller 가 store mirror + 다음 wake-up delay 계산에 사용.
 */
import type { ClientMessageId } from '@/domain/entities/Message';
import { BotApiError } from '@/domain/rules/BotApiError';

import type { ChatUseCaseDeps } from './types';

export interface FlushOutboxInput {
  /** 한 번의 flush 에서 시도할 최대 메시지 수. 기본은 전체. */
  limit?: number;
  /** 단일 메시지 재시도 한계. 기본 3. */
  maxRetries?: number;
}

export interface FlushOutboxOutcome {
  sent: ClientMessageId[];
  failed: Array<{ messageId: ClientMessageId; error: unknown; retryCount: number }>;
  giveUp: ClientMessageId[];
  remaining: number;
}

export async function flushOutbox(
  deps: ChatUseCaseDeps,
  input: FlushOutboxInput = {},
): Promise<FlushOutboxOutcome> {
  const maxRetries = input.maxRetries ?? 3;
  const queue = deps.outboxRepo.listOldestFirst();
  const slice = typeof input.limit === 'number' ? queue.slice(0, input.limit) : queue;

  const sent: ClientMessageId[] = [];
  const failed: FlushOutboxOutcome['failed'] = [];
  const giveUp: ClientMessageId[] = [];

  for (const entry of slice) {
    const buddy = deps.buddiesRepo.findById(entry.buddyId);
    if (!buddy) {
      // Buddy was removed while message sat in queue — drop.
      deps.db.transaction(() => {
        deps.outboxRepo.remove(entry.messageId);
        deps.db.run('DELETE FROM messages WHERE client_message_id = ?', [entry.messageId]);
      });
      giveUp.push(entry.messageId);
      continue;
    }
    let token: string | null = null;
    try {
      token = await deps.tokenStore.load(buddy.id);
    } catch (err) {
      handleFailure(deps, entry, err, maxRetries, failed, giveUp);
      continue;
    }
    if (!token) {
      handleFailure(deps, entry, new Error('missing_bot_token'), maxRetries, failed, giveUp);
      continue;
    }

    // sending 상태로 다시 들어감 — UI 가 spinner 로 전환.
    deps.messagesRepo.updateStatus(entry.messageId, 'sending');

    try {
      const result = await deps.botApi.sendMessage(token, {
        chat_id: buddy.id,
        text: entry.text,
      });
      const serverMessageId = String(result.message_id);
      deps.db.transaction(() => {
        // outbox FK references messages(id) — remove the queue entry first.
        deps.outboxRepo.remove(entry.messageId);
        // adoptServerId: tolerant of the echo row landing first (PK conflict).
        deps.messagesRepo.adoptServerId(entry.messageId, serverMessageId);
      });
      sent.push(entry.messageId);
    } catch (err) {
      handleFailure(deps, entry, err, maxRetries, failed, giveUp);
    }
  }

  return {
    sent,
    failed,
    giveUp,
    remaining: deps.outboxRepo.count(),
  };
}

function handleFailure(
  deps: ChatUseCaseDeps,
  entry: { messageId: ClientMessageId; buddyId: string; text: string; retryCount: number; enqueuedAt: number },
  err: unknown,
  maxRetries: number,
  failed: FlushOutboxOutcome['failed'],
  giveUp: ClientMessageId[],
): void {
  const nextRetry = entry.retryCount + 1;
  const lastError = describeError(err);
  const fatal = nextRetry > maxRetries || !isRecoverableError(err);
  deps.db.transaction(() => {
    deps.messagesRepo.updateStatus(entry.messageId, 'failed');
    if (fatal) {
      deps.outboxRepo.remove(entry.messageId);
    } else {
      deps.outboxRepo.enqueue({
        ...entry,
        retryCount: nextRetry,
        lastError,
      });
    }
  });
  if (fatal) {
    giveUp.push(entry.messageId);
  } else {
    failed.push({ messageId: entry.messageId, error: err, retryCount: nextRetry });
  }
}

function isRecoverableError(err: unknown): boolean {
  if (err instanceof BotApiError) {
    return err.kind === 'network_error' ||
      err.kind === 'server_error' ||
      err.kind === 'rate_limited' ||
      err.kind === 'aborted';
  }
  // unknown errors are treated as recoverable (transient).
  return true;
}

function describeError(err: unknown): string {
  if (err instanceof BotApiError) {
    return `${err.kind}${err.description ? `: ${err.description}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 호출자가 setTimeout 으로 wrap 할 때 쓰는 helper. retryCount 0,1,2 → 2s, 4s, 8s. */
export function backoffDelayMs(retryCount: number, baseMs = 2000): number {
  return baseMs * Math.pow(2, Math.min(retryCount, 6));
}
