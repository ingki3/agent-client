import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessageSyncStateRepository } from '@/infrastructure/storage/repositories/message-sync-state-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';

import {
  type ChatBotTokenPort,
  type ChatUseCaseDeps,
  flushOutbox,
  listMessages,
  persistLocalDisplayMessage,
  persistRemoteMessage,
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
  relaySyncMessages?: ChatUseCaseDeps['relaySyncMessages'];
  relaySyncMessageSnapshots?: ChatUseCaseDeps['relaySyncMessageSnapshots'];
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
  const deps: ChatUseCaseDeps & { db: Database } = {
    db,
    buddiesRepo,
    messageSyncStateRepo: new MessageSyncStateRepository(db),
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
  if (opts.relaySyncMessages) deps.relaySyncMessages = opts.relaySyncMessages;
  if (opts.relaySyncMessageSnapshots) deps.relaySyncMessageSnapshots = opts.relaySyncMessageSnapshots;
  return deps;
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

  it('merges repeated relay updates for the same message_id to the final text', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessages: async () => [
        {
          update_id: 6113000,
          message: {
            message_id: 6113,
            date: 1780574725,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            outgoing: false,
            text: '…',
          },
        },
        {
          update_id: 6113002,
          message: {
            message_id: 6113,
            date: 1780574725,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            outgoing: false,
            text: '형님, 안녕하세요! 🐧\n\n선거일 휴식을 마치고 다시 활기',
          },
        },
        {
          update_id: 6113003,
          message: {
            message_id: 6113,
            date: 1780574725,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            outgoing: false,
            text: '형님, 안녕하세요! 🐧\n\n선거일 휴식을 마치고 다시 활기차게 시작하는 목요일 밤이네요!',
          },
        },
      ],
    });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 6113000 });
    expect(outcome.newOffset).toBe(6113004);
    expect(outcome.inserted.at(-1)?.text).toContain('활기차게 시작하는 목요일 밤');
    const persisted = deps.messagesRepo.findByServerId('6113');
    expect(persisted?.text).toContain('활기차게 시작하는 목요일 밤');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });

  it('hides helper submit context messages from relay update sync', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessages: async () => [
        {
          update_id: 6114000,
          message: {
            message_id: 6114,
            date: 1780574725,
            chat: { id: 1001, type: 'private' },
            from: { id: 5, is_bot: false, first_name: 'User' },
            outgoing: true,
            text: '사용자가 아래 후속 액션을 선택했습니다.\n\n```agent_helper_response\n{"value":"상세히 설명해줘"}\n```',
          },
        },
        {
          update_id: 6114001,
          message: {
            message_id: 6115,
            date: 1780574726,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001, is_bot: true, first_name: 'Echo' },
            outgoing: false,
            text: '후속 답변입니다.',
          },
        },
      ],
    });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 6114000 });
    expect(outcome.inserted).toHaveLength(1);
    expect(outcome.inserted[0]?.text).toBe('후속 답변입니다.');
    expect(deps.messagesRepo.findByServerId('6114')).toBeNull();
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });

  it('persists relay message snapshots by upserting the same message_id', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({
        cursor: 8,
        messages: [
          {
            id: '6113',
            peerId: 1001,
            messageId: 6113,
            role: 'agent',
            text: '초기 답변',
            status: 'streaming',
            date: 1780574725,
            updatedAt: 1,
            cursor: 6,
          },
          {
            id: '6113',
            peerId: 1001,
            messageId: 6113,
            role: 'agent',
            text: '최종 답변입니다.',
            status: 'complete',
            date: 1780574725,
            updatedAt: 2,
            cursor: 7,
            helperItems: [{ type: 'quick_replies', id: 'next', options: [{ label: '더 보기', value: '최종 답변을 더 설명해줘' }] }],
          },
        ],
      }),
    });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });
    expect(outcome.newOffset).toBe(8);
    expect(outcome.inserted.at(-1)?.text).toBe('최종 답변입니다.');
    expect(outcome.inserted.at(-1)?.helperItems).toHaveLength(1);
    const persisted = deps.messagesRepo.findByServerId('6113');
    expect(persisted?.text).toBe('최종 답변입니다.');
    expect(persisted?.helperItems).toHaveLength(1);
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    expect(deps.messageSyncStateRepo.getCursor('1001')).toBe(8);
    deps.db.close();
  });

  it('returns newly synced relay snapshots in conversation chronology even when cursor order reflects later edits', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({
        cursor: 101,
        messages: [
          {
            id: '5844',
            peerId: 1001,
            messageId: 5844,
            role: 'agent',
            text: '06:00 scheduled brief',
            status: 'complete',
            date: 1780434019,
            updatedAt: 1,
            cursor: 30,
          },
          {
            id: '5829',
            peerId: 1001,
            messageId: 5829,
            role: 'agent',
            text: '23:53 answer completed later',
            status: 'complete',
            date: 1780412027,
            updatedAt: 2,
            cursor: 100,
          },
        ],
      }),
    });

    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });

    expect(outcome.newOffset).toBe(101);
    expect(outcome.inserted.map((message) => message.id)).toEqual(['5829', '5844']);
    expect(deps.messagesRepo.listByBuddy('1001').map((message) => message.id)).toEqual(['5829', '5844']);
    deps.db.close();
  });

  it('hides duplicate relay snapshots with different message_id but identical answer text', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({
        cursor: 3690,
        messages: [
          {
            id: '6483',
            peerId: 1001,
            messageId: 6483,
            role: 'agent',
            text: "OpenAI가 준비 중인 **'AI OS'**는 단순한 챗봇 서비스인 ChatGPT를 넘어섭니다.",
            status: 'complete',
            date: 1780907571,
            updatedAt: 1,
            cursor: 3685,
          },
          {
            id: '6484',
            peerId: 1001,
            messageId: 6484,
            role: 'agent',
            text: "OpenAI가 준비 중인 **'AI OS'**는 단순한 챗봇 서비스인 ChatGPT를 넘어섭니다.",
            status: 'complete',
            date: 1780907574,
            updatedAt: 2,
            cursor: 3686,
          },
        ],
      }),
    });

    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });

    expect(outcome.inserted.map((message) => message.id)).toEqual(['6483']);
    expect(listMessages(deps, { buddyId: '1001' }).map((message) => message.id)).toEqual(['6483']);
    deps.db.close();
  });

  it('keeps identical agent answers with distinct message_ids arriving more than 5s apart', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({
        cursor: 3690,
        messages: [
          {
            id: '6483',
            peerId: 1001,
            messageId: 6483,
            role: 'agent',
            text: '네, 완료했습니다.',
            status: 'complete',
            date: 1780907571,
            updatedAt: 1,
            cursor: 3685,
          },
          {
            id: '6484',
            peerId: 1001,
            messageId: 6484,
            role: 'agent',
            text: '네, 완료했습니다.',
            status: 'complete',
            date: 1780907601,
            updatedAt: 2,
            cursor: 3686,
          },
        ],
      }),
    });

    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });

    expect(outcome.inserted.map((message) => message.id)).toEqual(['6483', '6484']);
    expect(listMessages(deps, { buddyId: '1001' }).map((message) => message.id)).toEqual(['6483', '6484']);
    deps.db.close();
  });

  it('hides helper submit context messages from relay snapshot sync', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({
        cursor: 10,
        messages: [
          {
            id: '6114',
            peerId: 1001,
            messageId: 6114,
            role: 'user',
            text: '사용자가 아래 후속 액션을 선택했습니다.\n\n```agent_helper_response\n{"value":"상세히 설명해줘"}\n```',
            status: 'complete',
            date: 1780574725,
            updatedAt: 1,
            cursor: 8,
          },
          {
            id: '6115',
            peerId: 1001,
            messageId: 6115,
            role: 'agent',
            text: '후속 답변입니다.',
            status: 'complete',
            date: 1780574726,
            updatedAt: 2,
            cursor: 9,
          },
        ],
      }),
    });
    const outcome = await receiveUpdates(deps, { buddyId: '1001', offset: 0 });
    expect(outcome.inserted).toHaveLength(1);
    expect(outcome.inserted[0]?.text).toBe('후속 답변입니다.');
    expect(deps.messagesRepo.findByServerId('6114')).toBeNull();
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    expect(outcome.newOffset).toBe(10);
    expect(deps.messageSyncStateRepo.getCursor('1001')).toBe(10);
    deps.db.close();
  });

  it('hides previously persisted helper submit context messages from history', () => {
    const deps = openDeps({});
    deps.messagesRepo.insert({
      id: '6114',
      clientMessageId: '6114',
      buddyId: '1001',
      role: 'user',
      text: '사용자가 아래 후속 액션을 선택했습니다.\n\n```agent_helper_response\n{"value":"상세히 설명해줘"}\n```',
      status: 'sent',
      createdAt: 1780574725000,
      traceId: null,
    });
    deps.messagesRepo.insert({
      id: '6115',
      clientMessageId: '6115',
      buddyId: '1001',
      role: 'agent',
      text: '후속 답변입니다.',
      status: 'sent',
      createdAt: 1780574726000,
      traceId: null,
    });

    const history = listMessages(deps, { buddyId: '1001' });
    expect(history.map((message) => message.text)).toEqual(['후속 답변입니다.']);
    deps.db.close();
  });

  it('hides previously persisted duplicate answer messages from history', () => {
    const deps = openDeps({});
    deps.messagesRepo.insert({
      id: '6483',
      clientMessageId: '6483',
      buddyId: '1001',
      role: 'agent',
      text: "OpenAI가 준비 중인 **'AI OS'**는 단순한 챗봇 서비스인 ChatGPT를 넘어섭니다.",
      status: 'sent',
      createdAt: 1780907571000,
      traceId: null,
    });
    deps.messagesRepo.insert({
      id: '6484',
      clientMessageId: '6484',
      buddyId: '1001',
      role: 'agent',
      text: "OpenAI가 준비 중인 **'AI OS'**는 단순한 챗봇 서비스인 ChatGPT를 넘어섭니다.",
      status: 'sent',
      createdAt: 1780907574000,
      traceId: null,
    });

    const history = listMessages(deps, { buddyId: '1001' });
    expect(history.map((message) => message.id)).toEqual(['6483']);
    deps.db.close();
  });
});

describe('persistRemoteMessage', () => {
  it('persists stream snapshots and advances local relay cursor', () => {
    const deps = openDeps({ tokenOverride: {} });

    const message = persistRemoteMessage(deps, {
      id: '7001',
      peerId: 1001,
      messageId: 7001,
      role: 'agent',
      text: 'streamed answer',
      status: 'complete',
      date: 1780575000,
      updatedAt: 5,
      cursor: 12,
      helperItems: [{ type: 'quick_replies', id: 'next', options: [{ label: '더 보기', value: '더 설명해줘' }] }],
    });

    expect(message?.text).toBe('streamed answer');
    expect(deps.messagesRepo.findByServerId('7001')?.helperItems).toHaveLength(1);
    expect(deps.messageSyncStateRepo.getCursor('1001')).toBe(12);
    deps.db.close();
  });

  it('merges helper_updated snapshot into an existing local message row', () => {
    const deps = openDeps({ tokenOverride: {} });

    persistRemoteMessage(deps, {
      id: '7002',
      peerId: 1001,
      messageId: 7002,
      role: 'agent',
      text: 'answer without helper yet',
      status: 'complete',
      date: 1780575001,
      updatedAt: 6,
      cursor: 13,
    });

    const merged = persistRemoteMessage(deps, {
      id: '7002',
      peerId: 1001,
      messageId: 7002,
      role: 'agent',
      text: 'answer without helper yet',
      status: 'complete',
      date: 1780575001,
      updatedAt: 7,
      cursor: 14,
      helperItems: [{ type: 'quick_replies', id: 'follow', options: [{ label: '요약', value: '요약해줘' }] }],
    });

    expect(merged?.helperItems).toHaveLength(1);
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    expect(deps.messageSyncStateRepo.getCursor('1001')).toBe(14);
    deps.db.close();
  });

  it('supports stream message_updated/helper_updated by persisting repeated snapshots', () => {
    const deps = openDeps({ tokenOverride: {} });
    const first = persistRemoteMessage(deps, {
      id: '7100', peerId: 1001, messageId: 7100, role: 'agent', text: 'partial',
      status: 'streaming', date: 1780575100, updatedAt: 1, cursor: 20,
    });
    const second = persistRemoteMessage(deps, {
      id: '7100', peerId: 1001, messageId: 7100, role: 'agent', text: 'final',
      status: 'complete', date: 1780575100, updatedAt: 2, cursor: 21,
      helperItems: [{ type: 'quick_replies', id: 'q', options: [{ label: 'OK', value: 'ok' }] }],
    });

    expect(first?.text).toBe('partial');
    expect(second?.text).toBe('final');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    expect(deps.messageSyncStateRepo.getCursor('1001')).toBe(21);
    deps.db.close();
  });

  it('adopts the optimistic local row via clientTag instead of inserting a duplicate', () => {
    const deps = openDeps({ tokenOverride: {} });
    deps.messagesRepo.insert({
      id: null,
      clientMessageId: 'cm-echo-1',
      buddyId: '1001',
      role: 'user',
      text: 'hello agent',
      status: 'sending',
      createdAt: 1780575300500,
      traceId: null,
    });

    const adopted = persistRemoteMessage(deps, {
      id: '8001', peerId: 1001, messageId: 8001, role: 'user', text: 'hello agent',
      status: 'complete', date: 1780575301, updatedAt: 1, cursor: 30,
      clientTag: 'cm-echo-1',
    });

    expect(adopted?.clientMessageId).toBe('cm-echo-1');
    expect(adopted?.id).toBe('8001');
    expect(adopted?.status).toBe('sent');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });

  it('adopts a pending user row by text when the relay sends no clientTag', () => {
    const deps = openDeps({ tokenOverride: {} });
    deps.messagesRepo.insert({
      id: null,
      clientMessageId: 'cm-echo-2',
      buddyId: '1001',
      role: 'user',
      text: '  hello   fallback  ',
      status: 'sending',
      createdAt: 1780575400500,
      traceId: null,
    });

    const adopted = persistRemoteMessage(deps, {
      id: '8002', peerId: 1001, messageId: 8002, role: 'user', text: 'hello fallback',
      status: 'complete', date: 1780575401, updatedAt: 1, cursor: 31,
    });

    expect(adopted?.clientMessageId).toBe('cm-echo-2');
    expect(adopted?.id).toBe('8002');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });

  it('does not adopt already-sent rows or old pending rows via the text fallback', () => {
    const deps = openDeps({ tokenOverride: {} });
    deps.messagesRepo.insert({
      id: '7999',
      clientMessageId: 'cm-sent',
      buddyId: '1001',
      role: 'user',
      text: 'same words',
      status: 'sent',
      createdAt: 1780575500000,
      traceId: null,
    });
    deps.messagesRepo.insert({
      id: null,
      clientMessageId: 'cm-stale',
      buddyId: '1001',
      role: 'user',
      text: 'same words',
      status: 'sending',
      createdAt: 1780575500000 - 120_000,
      traceId: null,
    });

    const inserted = persistRemoteMessage(deps, {
      id: '8003', peerId: 1001, messageId: 8003, role: 'user', text: 'same words',
      status: 'complete', date: 1780575500, updatedAt: 1, cursor: 32,
    });

    expect(inserted?.clientMessageId).toBe('8003');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(3);
    deps.db.close();
  });

  it('double-send of identical text adopts echoes oldest-first', () => {
    const deps = openDeps({ tokenOverride: {} });
    for (const [cmId, createdAt] of [['cm-dup-1', 1780575600100], ['cm-dup-2', 1780575600900]] as const) {
      deps.messagesRepo.insert({
        id: null, clientMessageId: cmId, buddyId: '1001', role: 'user',
        text: 'ok', status: 'sending', createdAt, traceId: null,
      });
    }

    const first = persistRemoteMessage(deps, {
      id: '8004', peerId: 1001, messageId: 8004, role: 'user', text: 'ok',
      status: 'complete', date: 1780575601, updatedAt: 1, cursor: 33,
    });
    const second = persistRemoteMessage(deps, {
      id: '8005', peerId: 1001, messageId: 8005, role: 'user', text: 'ok',
      status: 'complete', date: 1780575602, updatedAt: 2, cursor: 34,
    });

    expect(first?.clientMessageId).toBe('cm-dup-1');
    expect(second?.clientMessageId).toBe('cm-dup-2');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(2);
    deps.db.close();
  });
});

describe('adoptServerId', () => {
  it('markSent after the echo row landed does not throw and leaves one row', async () => {
    const deps = openDeps({
      tokenOverride: {},
      relaySyncMessageSnapshots: async () => ({ cursor: 0, messages: [] }),
    });
    // Simulate: relay echo snapshot arrives BEFORE /send resolves — persisted
    // as its own row keyed by the server id (no clientTag from an old relay,
    // and outside the text window so no adoption either).
    deps.messagesRepo.insert({
      id: '9001',
      clientMessageId: '9001',
      buddyId: '1001',
      role: 'user',
      text: 'race me',
      status: 'sent',
      createdAt: 1780575700000,
      traceId: null,
    });
    // The optimistic local row for the same logical message.
    deps.messagesRepo.insert({
      id: null,
      clientMessageId: 'cm-race',
      buddyId: '1001',
      role: 'user',
      text: 'race me',
      status: 'sending',
      createdAt: 1780575700000,
      traceId: null,
    });

    // Regression: updateServerId here used to throw UNIQUE/PK constraint.
    expect(() => deps.messagesRepo.adoptServerId('cm-race', '9001')).not.toThrow();

    const adopted = deps.messagesRepo.findByServerId('9001');
    expect(adopted?.clientMessageId).toBe('cm-race');
    expect(adopted?.status).toBe('sent');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });

  it('is idempotent when the row already carries the server id', () => {
    const deps = openDeps({ tokenOverride: {} });
    deps.messagesRepo.insert({
      id: null, clientMessageId: 'cm-idem', buddyId: '1001', role: 'user',
      text: 'once', status: 'sending', createdAt: 1780575800000, traceId: null,
    });
    deps.messagesRepo.adoptServerId('cm-idem', '9100');
    expect(() => deps.messagesRepo.adoptServerId('cm-idem', '9100')).not.toThrow();
    expect(deps.messagesRepo.findByServerId('9100')?.clientMessageId).toBe('cm-idem');
    expect(deps.messagesRepo.listByBuddy('1001')).toHaveLength(1);
    deps.db.close();
  });
});

describe('persistLocalDisplayMessage', () => {
  it('stores user-facing helper action bubbles in SQLite', () => {
    const deps = openDeps({ tokenOverride: {} });

    const message = persistLocalDisplayMessage(deps, {
      buddyId: '1001',
      role: 'user',
      text: '상세히 설명해줘',
      clientMessageId: 'helper-user-1',
      createdAt: 1780575200000,
    });

    expect(message.clientMessageId).toBe('helper-user-1');
    expect(deps.messagesRepo.findByClientMessageId('helper-user-1')?.text).toBe('상세히 설명해줘');
    expect(listMessages(deps, { buddyId: '1001' }).map((item) => item.text)).toEqual(['상세히 설명해줘']);
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
