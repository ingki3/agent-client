import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';

import {
  type ChatBotTokenPort,
  type ChatUseCaseDeps,
  flushOutbox,
  receiveUpdates,
  retryMessage,
  sendMessage,
} from '@/application/usecases/chat';

interface FetchCall {
  url: string;
  body: string;
}

function makeFetch(
  responses: Array<((call: FetchCall) => unknown) | Error | { status: number; body: unknown }>,
): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body });
    const next = responses[idx++];
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') {
      const result = next({ url, body });
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

class FakeTokenStore implements ChatBotTokenPort {
  constructor(private readonly map: Record<string, string>) {}
  async load(buddyId: string): Promise<string | null> {
    return this.map[buddyId] ?? null;
  }
}

function openDeps(opts: {
  tokenOverride?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): ChatUseCaseDeps & { db: Database } {
  const db = createBetterSqlite3Database();
  applyMigrations(db);
  const buddiesRepo = new BuddiesRepository(db);
  buddiesRepo.upsert({
    id: '1001',
    username: 'echo_bot',
    displayName: 'Echo',
    iconUrl: null,
    traceSupported: false,
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: 1,
  });
  return {
    db,
    buddiesRepo,
    messagesRepo: new MessagesRepository(db),
    outboxRepo: new OutboxRepository(db),
    tokenStore: new FakeTokenStore(opts.tokenOverride ?? { '1001': 'token-1001' }),
    botApi: opts.fetchImpl
      ? new BotApiClient({ gateway: 'https://test.local', fetchImpl: opts.fetchImpl })
      : new BotApiClient({ gateway: 'https://test.local' }),
    newClientMessageId: (() => {
      let n = 0;
      return () => `cm-${++n}`;
    })(),
    now: (() => {
      let t = 100;
      return () => ++t;
    })(),
  };
}

describe('sendMessage', () => {
  it('online happy path: status sending → sent, server id mapped', async () => {
    const { fn, calls } = makeFetch([
      () => ({
        message_id: 42,
        date: 1,
        chat: { id: 1001, type: 'private' },
        text: 'hello',
      }),
    ]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await sendMessage(deps, {
      buddyId: '1001',
      text: 'hello',
      isOnline: true,
    });
    expect(outcome.kind).toBe('sent');
    if (outcome.kind === 'sent') {
      expect(outcome.serverMessageId).toBe('42');
    }
    const persisted = deps.messagesRepo.findByClientMessageId('cm-1');
    expect(persisted?.status).toBe('sent');
    expect(persisted?.id).toBe('42');
    expect(deps.outboxRepo.count()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/bottoken-1001/sendMessage');
    deps.db.close();
  });

  it('offline path: status queued + outbox enqueue, no API call', async () => {
    const { fn, calls } = makeFetch([]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await sendMessage(deps, {
      buddyId: '1001',
      text: 'offline-msg',
      isOnline: false,
    });
    expect(outcome.kind).toBe('queued-offline');
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('queued');
    expect(deps.outboxRepo.count()).toBe(1);
    expect(calls).toHaveLength(0);
    deps.db.close();
  });

  it('network failure: status failed + outbox enqueue (recoverable)', async () => {
    const { fn } = makeFetch([new Error('socket reset')]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await sendMessage(deps, {
      buddyId: '1001',
      text: 'will-fail',
      isOnline: true,
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.queued).toBe(true);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('failed');
    expect(deps.outboxRepo.count()).toBe(1);
    deps.db.close();
  });

  it('401 invalid_token: status failed, NOT enqueued (non-recoverable)', async () => {
    const { fn } = makeFetch([
      {
        status: 401,
        body: { ok: false, error_code: 401, description: 'Unauthorized' },
      },
    ]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await sendMessage(deps, {
      buddyId: '1001',
      text: 'bad-token',
      isOnline: true,
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.queued).toBe(false);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('failed');
    expect(deps.outboxRepo.count()).toBe(0);
    deps.db.close();
  });

  it('rejects empty text', async () => {
    const { fn } = makeFetch([]);
    const deps = openDeps({ fetchImpl: fn });
    await expect(
      sendMessage(deps, { buddyId: '1001', text: '   ', isOnline: true }),
    ).rejects.toThrow(/empty/);
    deps.db.close();
  });

  it('throws BuddyNotFoundError when buddy does not exist', async () => {
    const { fn } = makeFetch([]);
    const deps = openDeps({ fetchImpl: fn });
    await expect(
      sendMessage(deps, { buddyId: '9999', text: 'x', isOnline: true }),
    ).rejects.toMatchObject({ kind: 'buddy_not_found' });
    deps.db.close();
  });
});

describe('retryMessage', () => {
  it('failed → sent + outbox removed', async () => {
    const { fn } = makeFetch([
      new Error('initial-failure'),
      () => ({ message_id: 77, date: 2, chat: { id: 1001, type: 'private' } }),
    ]);
    const deps = openDeps({ fetchImpl: fn });
    const first = await sendMessage(deps, {
      buddyId: '1001',
      text: 'retry-me',
      isOnline: true,
    });
    expect(first.kind).toBe('failed');
    expect(deps.outboxRepo.count()).toBe(1);
    const retry = await retryMessage(deps, {
      clientMessageId: 'cm-1',
      isOnline: true,
    });
    expect(retry.kind).toBe('sent');
    if (retry.kind === 'sent') expect(retry.serverMessageId).toBe('77');
    expect(deps.outboxRepo.count()).toBe(0);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('sent');
    deps.db.close();
  });

  it('offline retry → queued-offline + outbox upsert', async () => {
    const { fn } = makeFetch([new Error('first-fail')]);
    const deps = openDeps({ fetchImpl: fn });
    await sendMessage(deps, {
      buddyId: '1001',
      text: 'queue-me',
      isOnline: true,
    });
    expect(deps.outboxRepo.count()).toBe(1);
    const retry = await retryMessage(deps, {
      clientMessageId: 'cm-1',
      isOnline: false,
    });
    expect(retry.kind).toBe('queued-offline');
    expect(deps.outboxRepo.count()).toBe(1);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('queued');
    deps.db.close();
  });

  it('throws MessageNotFoundError for unknown clientMessageId', async () => {
    const { fn } = makeFetch([]);
    const deps = openDeps({ fetchImpl: fn });
    await expect(
      retryMessage(deps, { clientMessageId: 'nope', isOnline: true }),
    ).rejects.toMatchObject({ kind: 'message_not_found' });
    deps.db.close();
  });
});

describe('receiveUpdates', () => {
  it('persists new bot messages and advances offset', async () => {
    const { fn } = makeFetch([
      () => [
        {
          update_id: 10,
          message: {
            message_id: 101,
            date: 50,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            text: 'hello from bot',
          },
        },
        {
          update_id: 11,
          message: {
            message_id: 102,
            date: 51,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            text: 'and another',
          },
        },
      ],
    ]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });
    expect(outcome.newOffset).toBe(12);
    expect(outcome.inserted).toHaveLength(2);
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(2);
    deps.db.close();
  });

  it('ignores user messages and other chat ids; dedupes same message_id', async () => {
    const { fn } = makeFetch([
      () => [
        {
          update_id: 1,
          message: {
            message_id: 200,
            date: 60,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            text: 'first',
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 200, // dupe message_id
            date: 60,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            text: 'first',
          },
        },
        {
          update_id: 3,
          message: {
            message_id: 999,
            date: 60,
            chat: { id: 9999, type: 'private' }, // wrong buddy
            from: { id: 9999, is_bot: true, first_name: 'Other' },
            text: 'noise',
          },
        },
        {
          update_id: 4,
          message: {
            message_id: 1000,
            date: 60,
            chat: { id: 1001, type: 'private' },
            from: { id: 5, is_bot: false, first_name: 'User' }, // user
            text: 'self echo',
          },
        },
      ],
    ]);
    const deps = openDeps({ fetchImpl: fn });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });
    expect(outcome.inserted).toHaveLength(1);
    expect(outcome.newOffset).toBe(5);
    deps.db.close();
  });
});

describe('flushOutbox', () => {
  it('retries queued messages and removes on success', async () => {
    const { fn } = makeFetch([
      new Error('queue-pre-failure'),
      () => ({ message_id: 200, date: 3, chat: { id: 1001, type: 'private' } }),
    ]);
    const deps = openDeps({ fetchImpl: fn });
    await sendMessage(deps, {
      buddyId: '1001',
      text: 'enqueued',
      isOnline: true,
    });
    expect(deps.outboxRepo.count()).toBe(1);
    const outcome = await flushOutbox(deps);
    expect(outcome.sent).toEqual(['cm-1']);
    expect(outcome.remaining).toBe(0);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('sent');
    deps.db.close();
  });

  it('increments retryCount on transient failure and gives up after maxRetries', async () => {
    const { fn } = makeFetch([
      new Error('1'),
      new Error('2'),
      new Error('3'),
      new Error('4'),
      new Error('5'),
    ]);
    const deps = openDeps({ fetchImpl: fn });
    await sendMessage(deps, {
      buddyId: '1001',
      text: 'persistent-failure',
      isOnline: true,
    });
    expect(deps.outboxRepo.count()).toBe(1);
    // Loop calls to flushOutbox simulating wake-ups.
    let lastOutcome = await flushOutbox(deps, { maxRetries: 3 });
    expect(deps.outboxRepo.listOldestFirst()[0]?.retryCount).toBe(1);
    lastOutcome = await flushOutbox(deps, { maxRetries: 3 });
    expect(deps.outboxRepo.listOldestFirst()[0]?.retryCount).toBe(2);
    lastOutcome = await flushOutbox(deps, { maxRetries: 3 });
    expect(deps.outboxRepo.listOldestFirst()[0]?.retryCount).toBe(3);
    lastOutcome = await flushOutbox(deps, { maxRetries: 3 });
    // 4th attempt failure → fatal (nextRetry > 3)
    expect(lastOutcome.giveUp).toEqual(['cm-1']);
    expect(deps.outboxRepo.count()).toBe(0);
    expect(deps.messagesRepo.findByClientMessageId('cm-1')?.status).toBe('failed');
    deps.db.close();
  });
});
