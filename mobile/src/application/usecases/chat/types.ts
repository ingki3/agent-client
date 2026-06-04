/**
 * Chat use-case dependency surface (TECH §3.1, §3.3, §3.4).
 *
 * 화면 (app/(main)/chat/...) 은 composition root (`app/_runtime/chat.ts`) 가
 * 만든 single instance 를 그대로 넘긴다. 테스트에서는 in-memory DB + fake
 * `BotApiClient` + fake `BotTokenStore` 로 같은 deps 를 채워 사용한다
 * (TECH §2.3 ports & adapters).
 */
import type { BotApiClient } from '@/infrastructure/api/bot-api-client';
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Database } from '@/infrastructure/storage/database';
import type { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import type { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import type { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';
import type { TgUpdate } from '@/infrastructure/api/telegramBotApi';

/**
 * Port (TECH §2.3) — chat use-case 가 의존하는 봇 토큰 read interface.
 * 구체 adapter (BIZ-265 의 `bot-token-store.ts`, expo-secure-store backed) 는
 * composition root 에서 주입한다.
 */
export interface ChatBotTokenPort {
  load(buddyId: BuddyId): Promise<string | null>;
}

export interface ChatUseCaseDeps {
  db: Database;
  buddiesRepo: BuddiesRepository;
  messagesRepo: MessagesRepository;
  outboxRepo: OutboxRepository;
  tokenStore: ChatBotTokenPort;
  botApi: BotApiClient;
  relaySendMessage?: (peerId: number, text: string, clientTag?: string) => Promise<number>;
  relaySyncMessages?: (peerId: number, sinceUpdateId: number, limit?: number) => Promise<TgUpdate[]>;
  /** Inject `uuid()` so tests can pin clientMessageId. */
  newClientMessageId: () => string;
  /** Inject `Date.now()` so tests can pin timestamps. */
  now: () => number;
}

export class BuddyNotFoundError extends Error {
  readonly kind = 'buddy_not_found';
  constructor(buddyId: string) {
    super(`Buddy not registered: ${buddyId}`);
    this.name = 'BuddyNotFoundError';
  }
}

export class MissingBotTokenError extends Error {
  readonly kind = 'missing_bot_token';
  constructor(buddyId: string) {
    super(`No bot token saved for buddy: ${buddyId}`);
    this.name = 'MissingBotTokenError';
  }
}

export class MessageNotFoundError extends Error {
  readonly kind = 'message_not_found';
  constructor(messageId: string) {
    super(`Message not found: ${messageId}`);
    this.name = 'MessageNotFoundError';
  }
}
