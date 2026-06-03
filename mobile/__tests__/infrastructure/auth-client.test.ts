// AuthClient unit tests — BIZ-279.
//
// Tooling note (FIRST line, per CLAUDE.md §1): the issue title mentions "msw + Jest",
// but msw 2.x is incompatible with ts-jest CJS in this stack (`rettime` ESM-only deps —
// see __tests__/infrastructure/bot-api-client.test.ts header). Following the established
// project convention, we mock `globalThis.fetch` directly. The DoD (happy path + 4xx/5xx
// mapping + AbortController cancellation + 100% line coverage) is fully covered.

import Constants from 'expo-constants';

import { AuthApiError, authClient } from '@/infrastructure/api/auth-client';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'https://auth.example.test' } } },
}));

const BASE = 'https://auth.example.test';

function setApiBaseUrl(value: string | undefined): void {
  const extra = (Constants.expoConfig as unknown as { extra: { apiBaseUrl?: unknown } }).extra;
  extra.apiBaseUrl = value;
}

type StubInit = {
  status?: number;
  body?: unknown;
  /** Throw a TypeError to simulate a transport-level failure. */
  networkError?: boolean;
  /** Delay before resolving so AbortSignal can fire first. */
  delayMs?: number;
  /** Optional Retry-After header in seconds. */
  retryAfter?: string;
  /** Override Content-Type. Defaults to application/json. */
  contentType?: string | null;
  /** Replace the body with raw text (skip JSON.stringify). */
  rawText?: string;
};

type RecordedCall = { url: string; init: RequestInit | undefined };

function abortDomException(): DOMException {
  return new DOMException('aborted', 'AbortError');
}

function stubFetch(responses: StubInit | StubInit[]): { calls: RecordedCall[] } {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedCall[] = [];
  const impl = ((url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof url === 'string' ? url : url.toString(), init });
    const opts = queue.shift() ?? queue[queue.length - 1] ?? {};
    if (opts.networkError) {
      return Promise.reject(new TypeError('network down'));
    }
    if (init?.signal?.aborted) {
      return Promise.reject(abortDomException());
    }
    const respond = (): Response => {
      const headers: Record<string, string> = {};
      if (opts.contentType !== null) {
        headers['content-type'] = opts.contentType ?? 'application/json';
      }
      if (opts.retryAfter) headers['retry-after'] = opts.retryAfter;
      const status = opts.status ?? 200;
      const text = opts.rawText ?? (opts.body === undefined ? '' : JSON.stringify(opts.body));
      // 204 No Content cannot have a body per HTTP spec; Response ctor rejects non-null bodies.
      const body = status === 204 || text === '' ? null : text;
      return new Response(body, { status, headers });
    };
    if (opts.delayMs && opts.delayMs > 0) {
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(respond()), opts.delayMs);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(abortDomException());
          },
          { once: true },
        );
      });
    }
    return Promise.resolve(respond());
  }) as typeof fetch;

  jest.spyOn(globalThis, 'fetch').mockImplementation(impl);
  return { calls };
}

beforeEach(() => {
  jest.restoreAllMocks();
  setApiBaseUrl(BASE);
});

describe('authClient.sendCode', () => {
  it('happy path: POST /v1/auth/send-code with phone_number + channel, maps to camelCase', async () => {
    const { calls } = stubFetch({
      body: { request_id: 'req-1', expires_in: 600 },
    });
    const res = await authClient.sendCode({ phoneNumber: '+821012345678' });
    expect(res).toEqual({ requestId: 'req-1', expiresIn: 600 });

    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/send-code`);
    expect(calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body).toEqual({ phone_number: '+821012345678', channel: 'sms' });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('uses voice channel when supplied', async () => {
    const { calls } = stubFetch({ body: { request_id: 'r', expires_in: 60 } });
    await authClient.sendCode({ phoneNumber: '+821012345678', channel: 'voice' });
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body.channel).toBe('voice');
  });

  it('maps 400 invalid_phone -> AuthApiError("invalid_phone")', async () => {
    stubFetch({ status: 400, body: { code: 'invalid_phone', message: 'bad number' } });
    const err = await authClient
      .sendCode({ phoneNumber: 'garbage' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.code).toBe('invalid_phone');
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad number');
  });

  it('maps 429 with Retry-After -> rate_limited + retryAfterSec', async () => {
    stubFetch({ status: 429, body: { code: 'rate_limited' }, retryAfter: '30' });
    const err = await authClient
      .sendCode({ phoneNumber: '+821012345678' })
      .catch((e) => e);
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(30);
  });
});

describe('authClient.verifyCode', () => {
  it('happy path: returns access/refresh/expiresIn (refresh_token null defaults)', async () => {
    const { calls } = stubFetch({
      body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 },
    });
    const res = await authClient.verifyCode({ requestId: 'req-1', code: '123456' });
    expect(res).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600 });
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body).toEqual({ request_id: 'req-1', code: '123456' });
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/verify-code`);
  });

  it('omitting refresh_token in the response yields refreshToken=null', async () => {
    stubFetch({ body: { access_token: 'at', expires_in: 60 } });
    const res = await authClient.verifyCode({ requestId: 'r', code: '0' });
    expect(res.refreshToken).toBeNull();
  });

  it('maps 400 invalid_code -> AuthApiError("invalid_code")', async () => {
    stubFetch({ status: 400, body: { code: 'invalid_code', message: 'wrong code' } });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '000000' })
      .catch((e) => e);
    expect(err.code).toBe('invalid_code');
    expect(err.status).toBe(400);
  });

  it('maps 400 code_expired -> AuthApiError("code_expired")', async () => {
    stubFetch({ status: 400, body: { code: 'code_expired' } });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '000000' })
      .catch((e) => e);
    expect(err.code).toBe('code_expired');
  });

  it('maps 422 with unrecognized body.code -> invalid_code default', async () => {
    stubFetch({ status: 422, body: { code: 'mystery' } });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('invalid_code');
    expect(err.status).toBe(422);
  });

  it('maps 404 request_not_found -> request_not_found', async () => {
    stubFetch({ status: 404, body: { code: 'request_not_found' } });
    const err = await authClient
      .verifyCode({ requestId: 'gone', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('request_not_found');
    expect(err.status).toBe(404);
  });

  it('maps 404 without recognized code -> unknown', async () => {
    stubFetch({ status: 404, body: { message: 'gone' } });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('unknown');
  });

  it('maps 500 -> server', async () => {
    stubFetch({ status: 503, body: null });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('server');
    expect(err.status).toBe(503);
  });

  it('maps non-standard status (e.g. 418) -> unknown', async () => {
    stubFetch({ status: 418, body: {} });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('unknown');
  });

  it('empty error body still produces AuthApiError with HTTP status fallback message', async () => {
    stubFetch({ status: 500, rawText: '' });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('server');
    expect(err.message).toBe('HTTP 500');
    expect(err.retryAfterSec).toBeNull();
  });

  it('non-JSON error body is tolerated (readJsonSafe swallows parse errors)', async () => {
    stubFetch({ status: 500, rawText: '<html>nope</html>' });
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0' })
      .catch((e) => e);
    expect(err.code).toBe('server');
  });
});

describe('authClient.refresh', () => {
  it('happy path: POST /v1/auth/refresh and returns new tokens', async () => {
    const { calls } = stubFetch({
      body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 1800 },
    });
    const res = await authClient.refresh({ refreshToken: 'rt-1' });
    expect(res).toEqual({ accessToken: 'at-2', refreshToken: 'rt-2', expiresIn: 1800 });
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/refresh`);
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body).toEqual({ refresh_token: 'rt-1' });
  });

  it('maps 401 -> unauthorized', async () => {
    stubFetch({ status: 401, body: { message: 'expired' } });
    const err = await authClient.refresh({ refreshToken: 'bad' }).catch((e) => e);
    expect(err.code).toBe('unauthorized');
    expect(err.status).toBe(401);
  });

  it('maps 403 -> unauthorized', async () => {
    stubFetch({ status: 403, body: {} });
    const err = await authClient.refresh({ refreshToken: 'bad' }).catch((e) => e);
    expect(err.code).toBe('unauthorized');
  });

  it('null refresh_token in body normalizes to refreshToken=null', async () => {
    stubFetch({ body: { access_token: 'at', refresh_token: null, expires_in: 1 } });
    const res = await authClient.refresh({ refreshToken: 'rt' });
    expect(res.refreshToken).toBeNull();
  });
});

describe('authClient.logout', () => {
  it('happy path: 204 No Content resolves without throwing', async () => {
    const { calls } = stubFetch({ status: 204, contentType: null });
    await expect(
      authClient.logout({ accessToken: 'at-1', refreshToken: 'rt-1' }),
    ).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/logout`);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer at-1');
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body).toEqual({ refresh_token: 'rt-1' });
  });

  it('still sends Authorization without refresh_token when omitted', async () => {
    const { calls } = stubFetch({ status: 204 });
    await authClient.logout({ accessToken: 'at-1' });
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body.refresh_token).toBeUndefined();
  });

  it('server error surfaces as AuthApiError("server")', async () => {
    stubFetch({ status: 502, body: {} });
    await expect(
      authClient.logout({ accessToken: 'at-1' }),
    ).rejects.toMatchObject({ name: 'AuthApiError', code: 'server', status: 502 });
  });
});

describe('AuthClient transport errors', () => {
  it('TypeError from fetch -> AuthApiError("network")', async () => {
    stubFetch({ networkError: true });
    const err = await authClient
      .sendCode({ phoneNumber: '+821012345678' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.code).toBe('network');
  });

  it('caller AbortController surfaces as aborted', async () => {
    stubFetch({ delayMs: 1000, body: {} });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    const err = await authClient
      .sendCode({ phoneNumber: '+821012345678', signal: ctrl.signal })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err.code).toBe('aborted');
  });

  it('caller aborts BEFORE request — anySignal pre-aborts immediately', async () => {
    stubFetch({ delayMs: 1000, body: {} });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await authClient
      .verifyCode({ requestId: 'r', code: '0', signal: ctrl.signal })
      .catch((e) => e);
    expect(err.code).toBe('aborted');
  });
});

describe('AuthClient base URL handling', () => {
  it('falls back to DEFAULT_API_BASE when extra.apiBaseUrl is missing', async () => {
    setApiBaseUrl(undefined);
    const { calls } = stubFetch({ body: { request_id: 'r', expires_in: 1 } });
    await authClient.sendCode({ phoneNumber: '+821012345678' });
    expect(calls[0]?.url).toBe('http://localhost:8080/v1/auth/send-code');
  });

  it('strips trailing slashes from extra.apiBaseUrl', async () => {
    setApiBaseUrl('https://x.test///');
    const { calls } = stubFetch({ body: { request_id: 'r', expires_in: 1 } });
    await authClient.sendCode({ phoneNumber: '+821012345678' });
    expect(calls[0]?.url).toBe('https://x.test/v1/auth/send-code');
  });
});

describe('AuthApiError shape', () => {
  it('default constructor sets sane fallbacks', () => {
    const e = new AuthApiError('unknown');
    expect(e.name).toBe('AuthApiError');
    expect(e.code).toBe('unknown');
    expect(e.status).toBeNull();
    expect(e.retryAfterSec).toBeNull();
    expect(e.message).toBe('unknown');
  });
});
