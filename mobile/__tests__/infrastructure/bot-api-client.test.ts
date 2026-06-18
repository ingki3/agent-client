// BotApiClient unit tests.
// HTTP 응답은 BotApiClient 의 `fetchImpl` 주입 슬롯에 stub 을 꽂아 mocking 한다.
// (msw 2.x 는 CJS 환경에서 ESM-only `rettime` deps 와 호환되지 않아 ts-jest 환경에서
//  Jest 가 ESM 변환을 못 한다. fetchImpl 주입은 BotApiClient 가 의도적으로 노출한 테스트 슬롯이며
//  DoD 의 성공/401/네트워크 실패 시나리오를 모두 커버한다 — TECH §12.1 참조.)

import { BotApiError } from '@/domain/rules/BotApiError';
import { BotApiClient } from '@/infrastructure/api/bot-api-client';

const TOKEN = '123456:ABCDEF';
const GATEWAY = 'https://api.telegram.example';

type RequestRecord = { url: string; init: RequestInit | undefined };

interface StubFetchOptions {
  status?: number;
  json?: unknown;
  /** Throw a TypeError to simulate a transport-level (TCP) failure. */
  networkError?: boolean;
  /** Delay before resolving so AbortSignal can fire. */
  delayMs?: number;
}

function makeStubFetch(opts: StubFetchOptions): {
  fetch: typeof fetch;
  calls: RequestRecord[];
} {
  const calls: RequestRecord[] = [];
  const stub = ((url: RequestInfo | URL, init?: RequestInit) => {
    const recordedUrl = typeof url === 'string' ? url : url.toString();
    calls.push({ url: recordedUrl, init });
    if (opts.networkError) {
      return Promise.reject(new TypeError('network down'));
    }
    const respond = () => {
      const body = JSON.stringify(opts.json ?? { ok: true, result: true });
      return new Response(body, {
        status: opts.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    if (opts.delayMs && opts.delayMs > 0) {
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(respond()), opts.delayMs);
        if (init?.signal) {
          init.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true },
          );
        }
      });
    }
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { fetch: stub, calls };
}

function makeClient(stubFetch: typeof fetch): BotApiClient {
  return new BotApiClient({ gateway: GATEWAY, fetchImpl: stubFetch, requestTimeoutMs: 2000 });
}

describe('BotApiClient.getMe', () => {
  it('returns the bot user on success', async () => {
    const { fetch, calls } = makeStubFetch({
      json: { ok: true, result: { id: 42, is_bot: true, first_name: 'Buddy', username: 'buddy_bot' } },
    });
    const user = await makeClient(fetch).getMe(TOKEN);
    expect(user).toEqual({
      id: 42,
      is_bot: true,
      first_name: 'Buddy',
      username: 'buddy_bot',
    });
    expect(calls[0]?.url).toBe(`${GATEWAY}/bot${TOKEN}/getMe`);
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('maps 401 to BotApiError invalid_token', async () => {
    const { fetch } = makeStubFetch({
      status: 401,
      json: { ok: false, error_code: 401, description: 'Unauthorized' },
    });
    await expect(makeClient(fetch).getMe(TOKEN)).rejects.toMatchObject({
      name: 'BotApiError',
      kind: 'invalid_token',
      httpStatus: 401,
      errorCode: 401,
    });
  });

  it('maps network failure to BotApiError network_error', async () => {
    const { fetch } = makeStubFetch({ networkError: true });
    const err = await makeClient(fetch).getMe(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(BotApiError);
    expect(err.kind).toBe('network_error');
  });
});

describe('BotApiClient.sendMessage', () => {
  it('posts chat_id string-serialized to preserve BigInt safety', async () => {
    const { fetch, calls } = makeStubFetch({
      json: {
        ok: true,
        result: {
          message_id: 100,
          date: 1,
          chat: { id: 9876543210123, type: 'private' },
          text: 'hello',
        },
      },
    });
    const msg = await makeClient(fetch).sendMessage(TOKEN, {
      chat_id: '9876543210123',
      text: 'hello',
    });
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(typeof body.chat_id).toBe('string');
    expect(body.chat_id).toBe('9876543210123');
    expect(msg.message_id).toBe(100);
  });

  it('throws bad_request on ok:false from 200 response', async () => {
    const { fetch } = makeStubFetch({
      status: 200,
      json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
    });
    await expect(
      makeClient(fetch).sendMessage(TOKEN, { chat_id: '1', text: 'x' }),
    ).rejects.toMatchObject({ kind: 'bad_request', errorCode: 400 });
  });
});

describe('BotApiClient.editMessageText', () => {
  it('returns the edited message', async () => {
    const { fetch } = makeStubFetch({
      json: {
        ok: true,
        result: {
          message_id: 100,
          date: 1,
          chat: { id: 1, type: 'private' },
          text: 'edited',
          edit_date: 2,
        },
      },
    });
    const result = await makeClient(fetch).editMessageText(TOKEN, {
      chat_id: '1',
      message_id: 100,
      text: 'edited',
    });
    expect(result.text).toBe('edited');
  });

  it('401 from edit also maps to invalid_token', async () => {
    const { fetch } = makeStubFetch({
      status: 401,
      json: { ok: false, error_code: 401, description: 'Unauthorized' },
    });
    await expect(
      makeClient(fetch).editMessageText(TOKEN, { chat_id: '1', message_id: 1, text: 'x' }),
    ).rejects.toMatchObject({ kind: 'invalid_token' });
  });

  it('network failure surfaces as network_error', async () => {
    const { fetch } = makeStubFetch({ networkError: true });
    await expect(
      makeClient(fetch).editMessageText(TOKEN, { chat_id: '1', message_id: 1, text: 'x' }),
    ).rejects.toMatchObject({ kind: 'network_error' });
  });
});

describe('BotApiClient.getUpdates', () => {
  it('returns empty array when no updates', async () => {
    const { fetch, calls } = makeStubFetch({ json: { ok: true, result: [] } });
    const updates = await makeClient(fetch).getUpdates(TOKEN, { offset: 1, timeout: 0 });
    expect(updates).toEqual([]);
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body.offset).toBe(1);
  });

  it('401 maps to invalid_token', async () => {
    const { fetch } = makeStubFetch({
      status: 401,
      json: { ok: false, error_code: 401, description: 'Unauthorized' },
    });
    await expect(makeClient(fetch).getUpdates(TOKEN)).rejects.toMatchObject({
      kind: 'invalid_token',
    });
  });

  it('network failure surfaces as network_error', async () => {
    const { fetch } = makeStubFetch({ networkError: true });
    await expect(makeClient(fetch).getUpdates(TOKEN)).rejects.toMatchObject({
      kind: 'network_error',
    });
  });
});

describe('BotApiClient.sendChatAction', () => {
  it('returns true on success', async () => {
    const { fetch } = makeStubFetch({ json: { ok: true, result: true } });
    const ok = await makeClient(fetch).sendChatAction(TOKEN, {
      chat_id: '1',
      action: 'typing',
    });
    expect(ok).toBe(true);
  });

  it('401 maps to invalid_token', async () => {
    const { fetch } = makeStubFetch({
      status: 401,
      json: { ok: false, error_code: 401, description: 'Unauthorized' },
    });
    await expect(
      makeClient(fetch).sendChatAction(TOKEN, { chat_id: '1', action: 'typing' }),
    ).rejects.toMatchObject({ kind: 'invalid_token' });
  });

  it('network failure surfaces as network_error', async () => {
    const { fetch } = makeStubFetch({ networkError: true });
    await expect(
      makeClient(fetch).sendChatAction(TOKEN, { chat_id: '1', action: 'typing' }),
    ).rejects.toMatchObject({ kind: 'network_error' });
  });
});

describe('BotApiClient cancellation', () => {
  it('rejects with aborted when caller signals cancellation', async () => {
    const { fetch } = makeStubFetch({ delayMs: 500, json: { ok: true, result: [] } });
    const client = makeClient(fetch);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(
      client.getUpdates(TOKEN, { timeout: 30 }, controller.signal),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('rejects with network_error on request timeout', async () => {
    const { fetch } = makeStubFetch({ delayMs: 5_000, json: { ok: true, result: [] } });
    const client = new BotApiClient({
      gateway: GATEWAY,
      fetchImpl: fetch,
      requestTimeoutMs: 20,
    });
    await expect(client.getUpdates(TOKEN)).rejects.toMatchObject({
      kind: 'network_error',
    });
  });
});

describe('BotApiClient empty token guard', () => {
  it('throws invalid_token without invoking fetch', async () => {
    const { fetch, calls } = makeStubFetch({ json: { ok: true, result: true } });
    await expect(makeClient(fetch).getMe('')).rejects.toMatchObject({
      kind: 'invalid_token',
    });
    expect(calls).toHaveLength(0);
  });
});
