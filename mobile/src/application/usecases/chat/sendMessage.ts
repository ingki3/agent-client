/**
 * sendMessage — UC-04 1:1 텍스트 채팅 송신 (FR-11, FR-13).
 *
 * 흐름 (TECH §3.1):
 *   1. `clientMessageId = uuid()` 생성, SQLite INSERT `{status: 'sending'}`
 *   2. (caller) `useChatStore` optimistic append — composition root 가 위임 받음
 *   3. `BotApiClient.sendMessage` → 성공 시 status `'sent'` + server `message_id` 매핑
 *   4. 실패 (4xx/5xx/네트워크/오프라인) → status `'failed'` + outbox enqueue
 *
 * 결과 객체는 caller (`app/_runtime/chat.ts`) 가 `useChatStore` 와 `useNetworkStore`
 * 미러를 갱신할 수 있도록 충분한 정보를 담아 반환한다.
 */
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message, ServerMessageId } from '@/domain/entities/Message';
import { BotApiError } from '@/domain/rules/BotApiError';

import {
  BuddyNotFoundError,
  type ChatUseCaseDeps,
  MissingBotTokenError,
} from './types';

export interface SendMessageInput {
  buddyId: BuddyId;
  text: string;
  /** Network monitor 가 보고하는 현 시각 연결 상태. */
  isOnline: boolean;
  clientMessageId?: string;
  createdAt?: number;
  /** Called after the local SQLite insert, before any network send is awaited. */
  onPersisted?: (message: Message) => void;
}

export type SendMessageOutcome =
  | { kind: 'sent'; message: Message; serverMessageId: ServerMessageId }
  | { kind: 'failed'; message: Message; error: unknown; queued: boolean }
  | { kind: 'queued-offline'; message: Message };

export async function sendMessage(
  deps: ChatUseCaseDeps,
  input: SendMessageInput,
): Promise<SendMessageOutcome> {
  const trimmed = input.text.trim();
  if (!trimmed) {
    throw new Error('sendMessage: empty text is not allowed');
  }

  const buddy = deps.buddiesRepo.findById(input.buddyId);
  if (!buddy && !deps.relaySendMessage) throw new BuddyNotFoundError(input.buddyId);

  const clientMessageId = input.clientMessageId ?? deps.newClientMessageId();
  const createdAt = input.createdAt ?? deps.now();
  const initialStatus = input.isOnline ? 'sending' : 'queued';
  const buddyId = buddy?.id ?? input.buddyId;

  const message: Message = {
    id: null,
    clientMessageId,
    buddyId,
    role: 'user',
    text: trimmed,
    status: initialStatus,
    createdAt,
    traceId: null,
  };

  // 1. SQLite + outbox-on-offline 영속화. 오프라인이면 outbox 까지 같은 트랜잭션.
  deps.db.transaction(() => {
    deps.messagesRepo.insert(message);
    if (!input.isOnline) {
      deps.outboxRepo.enqueue({
        messageId: clientMessageId,
        buddyId,
        text: trimmed,
        retryCount: 0,
        lastError: null,
        enqueuedAt: createdAt,
      });
    }
  });
  input.onPersisted?.(message);

  if (!input.isOnline) {
    return { kind: 'queued-offline', message };
  }

  // 2. 토큰 → 전송. SecureStore 호출 실패는 4xx 와 동일하게 취급.
  let token: string | null = null;
  try {
    token = buddy ? await deps.tokenStore.load(buddy.id) : null;
  } catch (err) {
    const relayOutcome = await tryRelaySend(deps, message, trimmed);
    if (relayOutcome) return relayOutcome;
    return enqueueAndFail(deps, message, err);
  }
  if (!token) {
    const relayOutcome = await tryRelaySend(deps, message, trimmed);
    if (relayOutcome) return relayOutcome;
    const err = new MissingBotTokenError(buddyId);
    return enqueueAndFail(deps, message, err);
  }

  try {
    const result = await deps.botApi.sendMessage(token, {
      chat_id: buddyId,
      text: trimmed,
    });
    return markSent(deps, message, String(result.message_id));
  } catch (err) {
    return enqueueAndFail(deps, message, err);
  }
}

async function tryRelaySend(
  deps: ChatUseCaseDeps,
  message: Message,
  text: string,
): Promise<SendMessageOutcome | null> {
  if (!deps.relaySendMessage) return null;
  const peerId = Number(message.buddyId);
  if (!Number.isFinite(peerId)) return null;
  try {
    const messageId = await deps.relaySendMessage(peerId, text, message.clientMessageId);
    return markSent(deps, message, String(messageId));
  } catch (err) {
    return enqueueAndFail(deps, message, err);
  }
}

function markSent(
  deps: ChatUseCaseDeps,
  message: Message,
  serverMessageId: ServerMessageId,
): SendMessageOutcome {
  deps.db.transaction(() => {
    // adoptServerId (not updateServerId): the relay echo of this send can land
    // first as its own row with id = serverMessageId — a plain PK update would
    // conflict. Adoption merges + deletes the echo row, then assigns the id.
    deps.messagesRepo.adoptServerId(message.clientMessageId, serverMessageId);
  });
  return {
    kind: 'sent',
    message: { ...message, id: serverMessageId, status: 'sent' },
    serverMessageId,
  };
}

function enqueueAndFail(
  deps: ChatUseCaseDeps,
  message: Message,
  err: unknown,
): SendMessageOutcome {
  const lastError = describeError(err);
  // 영구 오류 (`invalid_token` / `bad_request`) 는 재시도 무의미 — outbox 에 넣지 않음.
  const recoverable = isRecoverableError(err);
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
  // SecureStore / unknown failures are also retryable.
  return !(err instanceof MissingBotTokenError);
}

function describeError(err: unknown): string {
  if (err instanceof BotApiError) {
    return `${err.kind}${err.description ? `: ${err.description}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
