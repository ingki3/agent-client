// useAuthStore unit tests — BIZ-279.
//
// Strategy:
//   - Mock @/infrastructure/api/auth-client so we control every endpoint return.
//   - Mock @/infrastructure/storage/secure-token-store with an in-memory map so
//     we can assert what was persisted / cleared per transition.
//   - Use jest.useFakeTimers() to make Date.now() / token expiry deterministic.
//
// Covers every store transition the issue lists:
//   sendCode / verifyCode / bootstrap (4 sub-cases) / signOut / handleUnauthorized
//   plus resendCode / resetCodeFlow / clearError for full transition coverage.

// ---- mocks (hoisted by Jest) ----------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: {} },
    easConfig: null,
  },
}));

jest.mock('@/infrastructure/api/relayClient', () => ({
  __esModule: true,
  relayClient: {
    authStatus: jest.fn(),
    authStart: jest.fn(),
    authCode: jest.fn(),
    auth2fa: jest.fn(),
    authLogout: jest.fn(),
  },
}));

jest.mock('@/infrastructure/api/auth-client', () => {
  class AuthApiErrorMock extends Error {
    code: string;
    status: number | null;
    retryAfterSec: number | null;
    constructor(
      code: string,
      message?: string,
      status: number | null = null,
      retryAfterSec: number | null = null,
    ) {
      super(message ?? code);
      this.name = 'AuthApiError';
      this.code = code;
      this.status = status;
      this.retryAfterSec = retryAfterSec;
    }
  }
  return {
    __esModule: true,
    AuthApiError: AuthApiErrorMock,
    authClient: {
      sendCode: jest.fn(),
      verifyCode: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    },
  };
});

jest.mock('@/infrastructure/storage/secure-token-store', () => {
  type Snap = {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number;
    phoneNumber: string | null;
  };
  const memory: { current: Snap | null } = { current: null };
  return {
    __esModule: true,
    TokenKeys: {
      accessToken: 'access_token_v1',
      refreshToken: 'refresh_token_v1',
      expiresAt: 'token_expires_at_v1',
      phoneNumber: 'auth_phone_v1',
    },
    secureTokenStore: {
      async save(snap: Snap): Promise<void> {
        memory.current = { ...snap };
      },
      async load(): Promise<Snap | null> {
        return memory.current ? { ...memory.current } : null;
      },
      async clear(): Promise<void> {
        memory.current = null;
      },
      // Test helpers
      __seed(snap: Snap | null): void {
        memory.current = snap ? { ...snap } : null;
      },
      __snapshot(): Snap | null {
        return memory.current ? { ...memory.current } : null;
      },
    },
  };
});

jest.mock('@/infrastructure/storage/secureStore', () => {
  const memory = new Map<string, string>();
  return {
    __esModule: true,
    SecureKeys: {
      deviceId: 'agentclient.device.id.v1',
      deviceSecret: 'agentclient.device.secret.v1',
      phone: 'agentclient.phone.v1',
      tgUserId: 'agentclient.tgUserId.v1',
    },
    secureStore: {
      async get(key: string): Promise<string | null> {
        return memory.get(key) ?? null;
      },
      async set(key: string, value: string): Promise<void> {
        memory.set(key, value);
      },
      async remove(key: string): Promise<void> {
        memory.delete(key);
      },
      async clearKnownKeys(): Promise<void> {
        memory.clear();
      },
    },
  };
});

import { useAuthStore } from '@/application/stores/auth';
import { AuthApiError, authClient } from '@/infrastructure/api/auth-client';
import { secureTokenStore } from '@/infrastructure/storage/secure-token-store';
import type { AuthTokenSnapshot } from '@/infrastructure/storage/secure-token-store';

const mockAuth = authClient as jest.Mocked<typeof authClient>;
const mockStore = secureTokenStore as unknown as typeof secureTokenStore & {
  __seed: (snap: AuthTokenSnapshot | null) => void;
  __snapshot: () => AuthTokenSnapshot | null;
};

const NOW = 1_700_000_000_000; // fixed unix ms anchor

function resetStore(): void {
  useAuthStore.setState({
    status: 'initializing',
    phoneE164: null,
    requestId: null,
    codeExpiresAt: null,
    tokenExpiresAt: null,
    lastError: null,
    pending: false,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetStore();
  mockStore.__seed(null);
  mockAuth.sendCode.mockReset();
  mockAuth.verifyCode.mockReset();
  mockAuth.refresh.mockReset();
  mockAuth.logout.mockReset();
});

afterAll(() => {
  jest.useRealTimers();
});

// ---- sendCode --------------------------------------------------------------

describe('sendCode', () => {
  it('happy path: status -> awaiting_code, requestId + codeExpiresAt set', async () => {
    mockAuth.sendCode.mockResolvedValueOnce({ requestId: 'req-1', expiresIn: 600 });
    const ok = await useAuthStore.getState().sendCode('+821012345678');
    expect(ok).toBe(true);
    const s = useAuthStore.getState();
    expect(s.status).toBe('awaiting_code');
    expect(s.phoneE164).toBe('+821012345678');
    expect(s.requestId).toBe('req-1');
    expect(s.codeExpiresAt).toBe(NOW + 600 * 1000);
    expect(s.pending).toBe(false);
    expect(s.lastError).toBeNull();
    expect(mockAuth.sendCode).toHaveBeenCalledWith({
      phoneNumber: '+821012345678',
      channel: 'sms',
      signal: expect.any(AbortSignal),
    });
  });

  it('voice channel is forwarded', async () => {
    mockAuth.sendCode.mockResolvedValueOnce({ requestId: 'r', expiresIn: 60 });
    await useAuthStore.getState().sendCode('+821012345678', 'voice');
    expect(mockAuth.sendCode).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'voice' }),
    );
  });

  it('failure path: lastError set to AuthApiError, returns false, no awaiting_code', async () => {
    const apiErr = new AuthApiError('invalid_phone', 'bad', 400);
    mockAuth.sendCode.mockRejectedValueOnce(apiErr);
    const ok = await useAuthStore.getState().sendCode('+1');
    expect(ok).toBe(false);
    const s = useAuthStore.getState();
    expect(s.status).not.toBe('awaiting_code');
    expect(s.pending).toBe(false);
    expect(s.lastError).toBe(apiErr);
  });

  it('non-AuthApiError thrown is wrapped into AuthApiError("unknown")', async () => {
    mockAuth.sendCode.mockRejectedValueOnce(new Error('boom'));
    await useAuthStore.getState().sendCode('+1');
    const err = useAuthStore.getState().lastError;
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err?.code).toBe('unknown');
  });

  it('subsequent sendCode aborts the previous in-flight controller', async () => {
    // Hold the first call open so we can observe the abort.
    let firstAbortFlag = false;
    mockAuth.sendCode.mockImplementationOnce((req) => {
      req.signal?.addEventListener('abort', () => {
        firstAbortFlag = true;
      });
      return new Promise(() => {
        /* never resolves */
      });
    });
    mockAuth.sendCode.mockResolvedValueOnce({ requestId: 'r2', expiresIn: 1 });

    const p1 = useAuthStore.getState().sendCode('+821011111111');
    // Allow microtasks to register the listener.
    await Promise.resolve();
    await useAuthStore.getState().sendCode('+821022222222');
    expect(firstAbortFlag).toBe(true);
    expect(useAuthStore.getState().requestId).toBe('r2');
    expect(p1).toBeInstanceOf(Promise);
  });
});

// ---- verifyCode -----------------------------------------------------------

describe('verifyCode', () => {
  it('rejects with request_not_found when no active code request', async () => {
    const ok = await useAuthStore.getState().verifyCode('123456');
    expect(ok).toBe(false);
    const err = useAuthStore.getState().lastError;
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err?.code).toBe('request_not_found');
    expect(mockAuth.verifyCode).not.toHaveBeenCalled();
  });

  it('happy path: tokens saved to SecureStore, status -> auth', async () => {
    useAuthStore.setState({
      status: 'awaiting_code',
      phoneE164: '+821012345678',
      requestId: 'req-1',
      codeExpiresAt: NOW + 60_000,
    });
    mockAuth.verifyCode.mockResolvedValueOnce({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresIn: 3600,
    });

    const ok = await useAuthStore.getState().verifyCode('123456');
    expect(ok).toBe(true);
    const s = useAuthStore.getState();
    expect(s.status).toBe('auth');
    expect(s.tokenExpiresAt).toBe(NOW + 3600 * 1000);
    expect(s.requestId).toBeNull();
    expect(s.codeExpiresAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.pending).toBe(false);

    expect(mockStore.__snapshot()).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: NOW + 3600 * 1000,
      phoneNumber: '+821012345678',
    });
  });

  it('failure path: invalid_code -> lastError, status unchanged', async () => {
    useAuthStore.setState({ status: 'awaiting_code', requestId: 'req-1', phoneE164: '+1' });
    const apiErr = new AuthApiError('invalid_code', 'nope', 400);
    mockAuth.verifyCode.mockRejectedValueOnce(apiErr);

    const ok = await useAuthStore.getState().verifyCode('000000');
    expect(ok).toBe(false);
    const s = useAuthStore.getState();
    expect(s.status).toBe('awaiting_code');
    expect(s.lastError).toBe(apiErr);
    expect(mockStore.__snapshot()).toBeNull();
  });

  it('non-AuthApiError thrown is wrapped into AuthApiError("unknown")', async () => {
    useAuthStore.setState({ requestId: 'r' });
    mockAuth.verifyCode.mockRejectedValueOnce('nope');
    await useAuthStore.getState().verifyCode('0');
    expect(useAuthStore.getState().lastError?.code).toBe('unknown');
  });
});

// ---- bootstrap (4 sub-cases per DoD) --------------------------------------

describe('bootstrap', () => {
  it('case 1: no stored token -> status guest', async () => {
    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(s.tokenExpiresAt).toBeNull();
    expect(s.phoneE164).toBeNull();
    expect(mockAuth.refresh).not.toHaveBeenCalled();
  });

  it('case 2: valid token (far from expiry) -> status auth, no refresh call', async () => {
    const expiresAt = NOW + 30 * 60 * 1000; // 30 min future
    mockStore.__seed({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt,
      phoneNumber: '+821012345678',
    });
    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.status).toBe('auth');
    expect(s.tokenExpiresAt).toBe(expiresAt);
    expect(s.phoneE164).toBe('+821012345678');
    expect(s.requestId).toBeNull();
    expect(mockAuth.refresh).not.toHaveBeenCalled();
  });

  it('case 3: about-to-expire + refresh success -> tokens replaced, status auth', async () => {
    const aboutToExpire = NOW + 30_000; // within REFRESH_GRACE_MS (60s)
    mockStore.__seed({
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: aboutToExpire,
      phoneNumber: '+821012345678',
    });
    mockAuth.refresh.mockResolvedValueOnce({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresIn: 1800,
    });

    await useAuthStore.getState().bootstrap();
    expect(mockAuth.refresh).toHaveBeenCalledWith({ refreshToken: 'rt-old' });
    const s = useAuthStore.getState();
    expect(s.status).toBe('auth');
    expect(s.tokenExpiresAt).toBe(NOW + 1800 * 1000);
    expect(mockStore.__snapshot()).toEqual({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresAt: NOW + 1800 * 1000,
      phoneNumber: '+821012345678',
    });
  });

  it('case 3b: refresh response without new refresh_token reuses the old one', async () => {
    const aboutToExpire = NOW + 30_000;
    mockStore.__seed({
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: aboutToExpire,
      phoneNumber: '+8210',
    });
    mockAuth.refresh.mockResolvedValueOnce({
      accessToken: 'at-new',
      refreshToken: null,
      expiresIn: 60,
    });
    await useAuthStore.getState().bootstrap();
    expect(mockStore.__snapshot()?.refreshToken).toBe('rt-old');
  });

  it('case 4: about-to-expire + refresh failure -> SecureStore cleared, status guest', async () => {
    mockStore.__seed({
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: NOW + 30_000,
      phoneNumber: '+1',
    });
    mockAuth.refresh.mockRejectedValueOnce(new AuthApiError('unauthorized', 'expired', 401));

    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(s.tokenExpiresAt).toBeNull();
    expect(s.phoneE164).toBeNull();
    expect(mockStore.__snapshot()).toBeNull();
  });

  it('case 5: expired token + no refreshToken -> SecureStore cleared, status guest', async () => {
    mockStore.__seed({
      accessToken: 'at-old',
      refreshToken: null,
      expiresAt: NOW - 10_000, // already expired
      phoneNumber: '+1',
    });
    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(mockStore.__snapshot()).toBeNull();
    expect(mockAuth.refresh).not.toHaveBeenCalled();
  });

  it('about-to-expire window but no refreshToken -> falls through to expired branch', async () => {
    mockStore.__seed({
      accessToken: 'at-old',
      refreshToken: null,
      expiresAt: NOW + 30_000, // within grace, but cannot refresh
      phoneNumber: '+1',
    });
    await useAuthStore.getState().bootstrap();
    // Within grace but no refresh: falls through and hits the "if (snap.expiresAt > nowMs())"
    // path which treats the token as still good. The implementation chooses to keep it.
    const s = useAuthStore.getState();
    expect(s.status).toBe('auth');
    expect(s.tokenExpiresAt).toBe(NOW + 30_000);
  });
});

// ---- signOut ---------------------------------------------------------------

describe('signOut', () => {
  it('calls logout with stored tokens, clears SecureStore, status guest', async () => {
    mockStore.__seed({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: NOW + 1_000,
      phoneNumber: '+1',
    });
    useAuthStore.setState({ status: 'auth', tokenExpiresAt: NOW + 1_000, phoneE164: '+1' });
    mockAuth.logout.mockResolvedValueOnce(undefined);

    await useAuthStore.getState().signOut();
    expect(mockAuth.logout).toHaveBeenCalledWith({ accessToken: 'at-1', refreshToken: 'rt-1' });
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(s.tokenExpiresAt).toBeNull();
    expect(s.phoneE164).toBeNull();
    expect(mockStore.__snapshot()).toBeNull();
  });

  it('best-effort: logout transport failure still wipes local state', async () => {
    mockStore.__seed({
      accessToken: 'at-1',
      refreshToken: null,
      expiresAt: NOW + 1_000,
      phoneNumber: null,
    });
    mockAuth.logout.mockRejectedValueOnce(new AuthApiError('network'));
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe('guest');
    expect(mockStore.__snapshot()).toBeNull();
    // refreshToken=null is forwarded as undefined per the signOut implementation.
    expect(mockAuth.logout).toHaveBeenCalledWith({ accessToken: 'at-1', refreshToken: undefined });
  });

  it('no stored token: skips logout call, still resets state', async () => {
    await useAuthStore.getState().signOut();
    expect(mockAuth.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('guest');
  });
});

// ---- handleUnauthorized ----------------------------------------------------

describe('handleUnauthorized', () => {
  it('wipes tokens and sets status guest with unauthorized lastError', async () => {
    mockStore.__seed({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: NOW + 1_000,
      phoneNumber: '+1',
    });
    useAuthStore.setState({ status: 'auth', tokenExpiresAt: NOW + 1_000, phoneE164: '+1' });

    await useAuthStore.getState().handleUnauthorized();
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(s.lastError).toBeInstanceOf(AuthApiError);
    expect(s.lastError?.code).toBe('unauthorized');
    expect(s.tokenExpiresAt).toBeNull();
    expect(mockStore.__snapshot()).toBeNull();
  });
});

// ---- resendCode / resetCodeFlow / clearError ------------------------------

describe('resendCode', () => {
  it('uses the stored phoneE164', async () => {
    useAuthStore.setState({ phoneE164: '+821011111111', status: 'awaiting_code' });
    mockAuth.sendCode.mockResolvedValueOnce({ requestId: 'r2', expiresIn: 60 });
    const ok = await useAuthStore.getState().resendCode('voice');
    expect(ok).toBe(true);
    expect(mockAuth.sendCode).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '+821011111111', channel: 'voice' }),
    );
  });

  it('returns false when phoneE164 is missing', async () => {
    expect(await useAuthStore.getState().resendCode()).toBe(false);
    expect(mockAuth.sendCode).not.toHaveBeenCalled();
  });
});

describe('resetCodeFlow', () => {
  it('aborts any in-flight controller and resets to guest', () => {
    useAuthStore.setState({
      status: 'awaiting_code',
      requestId: 'r1',
      codeExpiresAt: NOW + 1000,
      lastError: new AuthApiError('invalid_code'),
      pending: true,
    });
    useAuthStore.getState().resetCodeFlow();
    const s = useAuthStore.getState();
    expect(s.status).toBe('guest');
    expect(s.requestId).toBeNull();
    expect(s.codeExpiresAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.pending).toBe(false);
  });
});

describe('clearError', () => {
  it('clears lastError without touching other fields', () => {
    useAuthStore.setState({
      status: 'awaiting_code',
      requestId: 'r1',
      lastError: new AuthApiError('invalid_code'),
    });
    useAuthStore.getState().clearError();
    const s = useAuthStore.getState();
    expect(s.lastError).toBeNull();
    expect(s.status).toBe('awaiting_code');
    expect(s.requestId).toBe('r1');
  });
});
