// Buddies use-cases (addBuddy / removeBuddy / listBuddies) — BIZ-265.
//
// PRD UC-02·UC-03·FR-05~10. Covers:
//   - happy path (getMe → upsert → SecureStore save → /start)
//   - duplicate → DuplicateBuddyError, token NOT overwritten
//   - invalid token (getMe throws BotApiError) → no rows / no token saved
//   - removeBuddy cascade (messages / traces / outbox / buddy 모두 정리)
//   - /start 실패해도 등록은 유지 (startSent=false)
//
// 인프라 contract 는 BIZ-264 의 BotApiClient + BuddiesRepository 를 그대로 쓰고,
// SecureStore 만 fake 로 갈아끼움 (expo-secure-store 는 RN 전용).

import { BotApiError } from '@/domain/rules/BotApiError';
import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import type { TgBotUser, TgMessage } from '@/infrastructure/api/types';
import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';

import {
  addBuddy,
  DuplicateBuddyError,
  listBuddies,
  removeBuddy,
  type BuddiesUseCaseDeps,
} from '@/application/usecases/buddies';

// --- fakes ---------------------------------------------------------------

function makeTokenStore() {
  const map = new Map<string, string>();
  return {
    save: jest.fn(async (id: string, token: string) => {
      map.set(id, token);
    }),
    load: jest.fn(async (id: string) => map.get(id) ?? null),
    remove: jest.fn(async (id: string) => {
      map.delete(id);
    }),
    _map: map,
  };
}

type StubResponse =
  | { kind: 'ok'; body: unknown }
  | { kind: 'http'; status: number; body?: unknown };

function makeBotApi(responses: Record<string, StubResponse[]>): BotApiClient {
  const fetchImpl: typeof fetch = (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = Object.keys(responses).find((m) => url.endsWith(`/${m}`));
    if (!method) throw new Error(`No stub for ${url}`);
    const queue = responses[method];
    if (!queue) throw new Error(`No stub queue for ${method}`);
    const next = queue.shift();
    if (!next) throw new Error(`Stub exhausted: ${method}`);
    if (next.kind === 'http') {
      const body = JSON.stringify(
        next.body ?? { ok: false, error_code: next.status, description: 'stub' },
      );
      return Promise.resolve(
        new Response(body, {
          status: next.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: next.body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return new BotApiClient({ gateway: 'https://stub.test', fetchImpl });
}

function botUser(overrides: Partial<TgBotUser> = {}): TgBotUser {
  return {
    id: 8888,
    is_bot: true,
    first_name: 'Stub Bot',
    username: 'stub_bot',
    ...overrides,
  };
}

function stubMessage(): TgMessage {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 8888, type: 'private' },
    text: '/start',
  };
}

function setupDeps(api: BotApiClient): BuddiesUseCaseDeps & {
  tokenStore: ReturnType<typeof makeTokenStore>;
  db: Database;
} {
  const db = createBetterSqlite3Database();
  applyMigrations(db);
  const buddiesRepo = new BuddiesRepository(db);
  const tokenStore = makeTokenStore();
  return { db, buddiesRepo, tokenStore, botApi: api };
}

// --- tests ---------------------------------------------------------------

describe('addBuddy', () => {
  it('정상 토큰: getMe → upsert → SecureStore save → /start 전송', async () => {
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }],
      sendMessage: [{ kind: 'ok', body: stubMessage() }],
    });
    const deps = setupDeps(api);

    const result = await addBuddy(deps, { token: 'tok-A' });

    expect(result.buddy.id).toBe('8888');
    expect(result.buddy.displayName).toBe('stub_bot');
    expect(result.startSent).toBe(true);

    const persisted = deps.buddiesRepo.findById('8888');
    expect(persisted).not.toBeNull();
    expect(deps.tokenStore._map.get('8888')).toBe('tok-A');
  });

  it('displayName 우선순위 — input.displayName > username > first_name', async () => {
    const noUsername: TgBotUser = {
      id: 8888,
      is_bot: true,
      first_name: 'Bare Bot',
    };
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: noUsername }],
      sendMessage: [{ kind: 'ok', body: stubMessage() }],
    });
    const deps = setupDeps(api);

    const result = await addBuddy(deps, { token: 'tok-A' });
    expect(result.buddy.displayName).toBe('Bare Bot');

    const withInput = await addBuddy(setupDeps(makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }],
      sendMessage: [{ kind: 'ok', body: stubMessage() }],
    })), { token: 'tok-B', displayName: '내 일 봇' });
    expect(withInput.buddy.displayName).toBe('내 일 봇');
  });

  it('중복 토큰: DuplicateBuddyError + 기존 토큰 보존 + SecureStore 미덮어쓰기', async () => {
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }, { kind: 'ok', body: botUser() }],
      sendMessage: [{ kind: 'ok', body: stubMessage() }],
    });
    const deps = setupDeps(api);

    await addBuddy(deps, { token: 'tok-original' });
    expect(deps.tokenStore.save).toHaveBeenCalledTimes(1);

    await expect(addBuddy(deps, { token: 'tok-other' })).rejects.toBeInstanceOf(
      DuplicateBuddyError,
    );
    // 두 번째 시도는 SecureStore 를 건드리지 않아야 한다.
    expect(deps.tokenStore.save).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore._map.get('8888')).toBe('tok-original');
  });

  it('유효하지 않은 토큰 (401): BotApiError 전파, DB/SecureStore 모두 변동 없음', async () => {
    const api = makeBotApi({ getMe: [{ kind: 'http', status: 401 }] });
    const deps = setupDeps(api);

    await expect(addBuddy(deps, { token: 'bad' })).rejects.toBeInstanceOf(BotApiError);

    expect(deps.buddiesRepo.listAll()).toHaveLength(0);
    expect(deps.tokenStore.save).not.toHaveBeenCalled();
  });

  it('/start 실패해도 등록은 유지 — startSent=false + startError 전달', async () => {
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }],
      sendMessage: [{ kind: 'http', status: 500 }],
    });
    const deps = setupDeps(api);

    const result = await addBuddy(deps, { token: 'tok-A' });
    expect(result.startSent).toBe(false);
    expect(result.startError).toBeInstanceOf(BotApiError);
    expect(deps.buddiesRepo.findById('8888')).not.toBeNull();
    expect(deps.tokenStore._map.get('8888')).toBe('tok-A');
  });

  it('SecureStore.save 실패 시 SQLite row 도 롤백', async () => {
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }],
    });
    const deps = setupDeps(api);
    deps.tokenStore.save.mockRejectedValueOnce(new Error('keychain locked'));

    await expect(addBuddy(deps, { token: 'tok-A' })).rejects.toThrow('keychain locked');
    expect(deps.buddiesRepo.findById('8888')).toBeNull();
  });
});

describe('removeBuddy', () => {
  it('cascade — messages / traces / outbox / buddy 모두 정리 + SecureStore 토큰 삭제', async () => {
    const api = makeBotApi({
      getMe: [{ kind: 'ok', body: botUser() }],
      sendMessage: [{ kind: 'ok', body: stubMessage() }],
    });
    const deps = setupDeps(api);
    const { buddy } = await addBuddy(deps, { token: 'tok-A' });

    // 메시지·trace·outbox seed (use-case 가 cascade 잘 지우는지 검증용)
    deps.db.run(
      `INSERT INTO messages (id, client_message_id, buddy_id, role, text, status, created_at, trace_id)
       VALUES ('m1','c1',?, 'agent','hi','sent',1,NULL),
              ('m2','c2',?, 'user','hi back','sent',2,'t1')`,
      [buddy.id, buddy.id],
    );
    deps.db.run(
      `INSERT INTO traces (id, message_id, nodes, updated_at) VALUES ('t1','m2',?,1)`,
      [Buffer.from('[]')],
    );
    // outbox.message_id FK → messages.id (database.ts MIGRATIONS), not client_message_id.
    deps.db.run(
      `INSERT INTO outbox (message_id, buddy_id, text, retry_count, last_error, enqueued_at)
       VALUES ('m1',?, 'hi', 0, NULL, 1)`,
      [buddy.id],
    );

    await removeBuddy(deps, { buddyId: buddy.id });

    expect(deps.buddiesRepo.findById(buddy.id)).toBeNull();
    expect(deps.db.all('SELECT * FROM messages WHERE buddy_id = ?', [buddy.id])).toHaveLength(0);
    expect(deps.db.all('SELECT * FROM traces WHERE message_id IN (?, ?)', ['m1', 'm2'])).toHaveLength(0);
    expect(
      deps.db.all('SELECT * FROM outbox WHERE message_id IN (?, ?)', ['m1', 'm2']),
    ).toHaveLength(0);
    expect(deps.tokenStore.remove).toHaveBeenCalledWith(buddy.id);
    expect(deps.tokenStore._map.has(buddy.id)).toBe(false);
  });
});

describe('listBuddies', () => {
  it('마지막 메시지 시각 desc → 생성 시각 desc 순으로 정렬', () => {
    const deps = setupDeps(makeBotApi({}));
    // 직접 upsert 로 created_at / last_message_at 을 명시 — addBuddy 는 Date.now() 동일값 이슈.
    deps.buddiesRepo.upsert({
      id: '1', username: 'a', displayName: 'A', iconUrl: null, traceSupported: false,
      lastMessagePreview: null, lastMessageAt: null, unreadCount: 0, createdAt: 1000,
    });
    deps.buddiesRepo.upsert({
      id: '2', username: 'b', displayName: 'B', iconUrl: null, traceSupported: false,
      lastMessagePreview: 'hi', lastMessageAt: 5000, unreadCount: 0, createdAt: 2000,
    });
    deps.buddiesRepo.upsert({
      id: '3', username: 'c', displayName: 'C', iconUrl: null, traceSupported: false,
      lastMessagePreview: null, lastMessageAt: null, unreadCount: 0, createdAt: 3000,
    });

    const list = listBuddies(deps);
    expect(list.map((b) => b.id)).toEqual(['2', '3', '1']);
  });
});
