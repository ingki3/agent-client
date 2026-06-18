/**
 * AuthClient — phone + SMS auth (TECH §3.5).
 *
 * Endpoints (POST):
 *   /v1/auth/send-code     { phone_number, channel? } -> { request_id, expires_in }
 *   /v1/auth/verify-code   { request_id, code }       -> { access_token, refresh_token?, expires_in }
 *   /v1/auth/refresh       { refresh_token }          -> { access_token, refresh_token?, expires_in }
 *   /v1/auth/logout        { refresh_token? }         -> void
 *
 * Notes:
 * - AbortController supported on every call (param.signal).
 * - 4xx/5xx mapped to typed AuthApiError; transport failures to AuthApiError("network").
 * - Backend base URL is read from Expo Constants extra.apiBaseUrl with a localhost dev default.
 */
import Constants from 'expo-constants';

const DEFAULT_API_BASE = 'http://localhost:8080';
const DEFAULT_TIMEOUT_MS = 15_000;

type ExtraConfig = { apiBaseUrl?: unknown };

function readBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
  if (typeof extra.apiBaseUrl === 'string' && extra.apiBaseUrl.length > 0) {
    return extra.apiBaseUrl.replace(/\/+$/, '');
  }
  return DEFAULT_API_BASE;
}

export type AuthErrorCode =
  | 'invalid_phone'
  | 'rate_limited'
  | 'invalid_code'
  | 'code_expired'
  | 'invalid_password'
  | 'request_not_found'
  | 'unauthorized'
  | 'network'
  | 'aborted'
  | 'server'
  | 'unknown';

export class AuthApiError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number | null;
  readonly retryAfterSec: number | null;
  constructor(code: AuthErrorCode, message?: string, status: number | null = null, retryAfterSec: number | null = null) {
    super(message ?? code);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export type SendCodeRequest = {
  phoneNumber: string; // E.164, e.g. "+821012345678"
  channel?: 'sms' | 'voice';
  signal?: AbortSignal;
};
export type SendCodeResponse = {
  requestId: string;
  expiresIn: number; // seconds
};

export type VerifyCodeRequest = {
  requestId: string;
  code: string;
  signal?: AbortSignal;
};
export type VerifyCodeResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

export type RefreshRequest = {
  refreshToken: string;
  signal?: AbortSignal;
};
export type RefreshResponse = VerifyCodeResponse;

export type LogoutRequest = {
  accessToken: string;
  refreshToken?: string | undefined;
  signal?: AbortSignal | undefined;
};

type RawAuthOk = {
  access_token: string;
  refresh_token?: string | null;
  expires_in: number;
};
type RawSendOk = { request_id: string; expires_in: number };
type RawError = { code?: string; message?: string };

function mapStatusToCode(status: number, body: RawError | null): AuthErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return body?.code === 'request_not_found' ? 'request_not_found' : 'unknown';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) {
    if (body?.code === 'invalid_phone') return 'invalid_phone';
    if (body?.code === 'invalid_code') return 'invalid_code';
    if (body?.code === 'code_expired') return 'code_expired';
    return 'invalid_code';
  }
  if (status >= 500) return 'server';
  return 'unknown';
}

async function readJsonSafe(res: Response): Promise<RawError | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as RawError;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  body: unknown,
  init: { signal?: AbortSignal | undefined; accessToken?: string | undefined } = {},
): Promise<T> {
  const base = readBaseUrl();
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;

  // Compose caller's signal with a timeout signal so callers always get a deterministic upper bound.
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), DEFAULT_TIMEOUT_MS);
  const signal = init.signal ? anySignal([init.signal, timeoutCtrl.signal]) : timeoutCtrl.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AuthApiError(init.signal?.aborted ? 'aborted' : 'network', 'request aborted');
    }
    throw new AuthApiError('network', err instanceof Error ? err.message : 'network error');
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const raw = await readJsonSafe(res);
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : null;
    throw new AuthApiError(
      mapStatusToCode(res.status, raw),
      raw?.message ?? `HTTP ${res.status}`,
      res.status,
      Number.isFinite(retryAfterSec) ? retryAfterSec : null,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      return ctrl.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

export const authClient = {
  async sendCode(req: SendCodeRequest): Promise<SendCodeResponse> {
    const raw = await request<RawSendOk>(
      '/v1/auth/send-code',
      { phone_number: req.phoneNumber, channel: req.channel ?? 'sms' },
      { signal: req.signal },
    );
    return { requestId: raw.request_id, expiresIn: raw.expires_in };
  },

  async verifyCode(req: VerifyCodeRequest): Promise<VerifyCodeResponse> {
    const raw = await request<RawAuthOk>(
      '/v1/auth/verify-code',
      { request_id: req.requestId, code: req.code },
      { signal: req.signal },
    );
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token ?? null,
      expiresIn: raw.expires_in,
    };
  },

  async refresh(req: RefreshRequest): Promise<RefreshResponse> {
    const raw = await request<RawAuthOk>(
      '/v1/auth/refresh',
      { refresh_token: req.refreshToken },
      { signal: req.signal },
    );
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token ?? null,
      expiresIn: raw.expires_in,
    };
  },

  async logout(req: LogoutRequest): Promise<void> {
    await request<void>(
      '/v1/auth/logout',
      { refresh_token: req.refreshToken },
      { signal: req.signal, accessToken: req.accessToken },
    );
  },
};

export type AuthClient = typeof authClient;
