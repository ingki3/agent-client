/**
 * Buddies use-case 의 외부 의존성을 명시적으로 주입받기 위한 deps 타입.
 *
 * 화면 (app/(main)/...) 은 앱 부트스트랩에서 만든 single instance 를 import 해서
 * 그대로 넘긴다. 테스트에서는 in-memory DB + fake SecureStore + fake BotApiClient 로
 * 같은 deps 를 채워 사용한다 (TECH §2.3 ports & adapters).
 */
import type { BotApiClient } from '@/infrastructure/api/bot-api-client';
import type { Database } from '@/infrastructure/storage/database';
import type { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';

import type { BotTokenStore } from '@/infrastructure/storage/bot-token-store';

export interface BuddiesUseCaseDeps {
  db: Database;
  buddiesRepo: BuddiesRepository;
  tokenStore: BotTokenStore;
  botApi: BotApiClient;
}

export class DuplicateBuddyError extends Error {
  readonly kind = 'duplicate_buddy';
  constructor(public readonly existing: { id: string; displayName: string }) {
    super(`Buddy already registered: ${existing.id}`);
    this.name = 'DuplicateBuddyError';
  }
}
