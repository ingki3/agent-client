/**
 * useAuthStore — phone+SMS auth state machine (TECH §3.5, §4.2).
 *
 * State:
 *   status: 'initializing' | 'guest' | 'awaiting_code' | 'auth'
 *
 * Actions:
 *   bootstrap()                — cold-start: load SecureStore, refresh-or-clear, decide route.
 *   sendCode(phoneE164)        — POST /v1/auth/send-code; sets request_id + expiry; status -> awaiting_code.
 *   verifyCode(code)           — POST /v1/auth/verify-code; stores tokens; status -> auth.
 *   resendCode(channel?)       — resends with the same phone number; refreshes request_id.
 *   resetCodeFlow()            — return to phone entry (clears request_id + phone).
 *   signOut()                  — POST /v1/auth/logout (best-effort); wipes SecureStore; status -> guest.
 *   handleUnauthorized()       — 401 path: wipes tokens; status -> guest. Used by API layer.
 *
 * Token refresh:
 *   bootstrap() will try /v1/auth/refresh if the stored access token is within
 *   REFRESH_GRACE_MS of expiry (default 60s) and a refresh token exists; on failure it clears
 *   and falls back to guest.
 */
import { create } from 'zustand';
import { AuthApiError, authClient } from '@/infrastructure/api/auth-client';
import { secureTokenStore } from '@/infrastructure/storage/secure-token-store';

export type AuthStatus = 'initializing' | 'guest' | 'awaiting_code' | 'auth';

const REFRESH_GRACE_MS = 60_000;

export type AuthState = {
  status: AuthStatus;
  phoneE164: string | null;
  requestId: string | null;
  codeExpiresAt: number | null; // unix ms
  tokenExpiresAt: number | null; // unix ms
  lastError: AuthApiError | null;
  pending: boolean;

  bootstrap: () => Promise<void>;
  sendCode: (phoneE164: string, channel?: 'sms' | 'voice') => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  resendCode: (channel?: 'sms' | 'voice') => Promise<boolean>;
  resetCodeFlow: () => void;
  signOut: () => Promise<void>;
  handleUnauthorized: () => Promise<void>;
  clearError: () => void;
};

let inFlight: AbortController | null = null;

function newController(): AbortController {
  inFlight?.abort();
  inFlight = new AbortController();
  return inFlight;
}

function nowMs(): number {
  return Date.now();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'initializing',
  phoneE164: null,
  requestId: null,
  codeExpiresAt: null,
  tokenExpiresAt: null,
  lastError: null,
  pending: false,

  clearError: () => set({ lastError: null }),

  resetCodeFlow: () => {
    inFlight?.abort();
    inFlight = null;
    set({
      status: 'guest',
      requestId: null,
      codeExpiresAt: null,
      lastError: null,
      pending: false,
    });
  },

  bootstrap: async () => {
    set({ status: 'initializing', lastError: null });
    const snap = await secureTokenStore.load();
    if (!snap) {
      set({ status: 'guest', tokenExpiresAt: null, phoneE164: null });
      return;
    }

    const aboutToExpire = snap.expiresAt - nowMs() < REFRESH_GRACE_MS;
    if (aboutToExpire && snap.refreshToken) {
      try {
        const refreshed = await authClient.refresh({ refreshToken: snap.refreshToken });
        const expiresAt = nowMs() + refreshed.expiresIn * 1000;
        await secureTokenStore.save({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? snap.refreshToken,
          expiresAt,
          phoneNumber: snap.phoneNumber,
        });
        set({
          status: 'auth',
          phoneE164: snap.phoneNumber,
          tokenExpiresAt: expiresAt,
          requestId: null,
          codeExpiresAt: null,
        });
        return;
      } catch {
        await secureTokenStore.clear();
        set({ status: 'guest', tokenExpiresAt: null, phoneE164: null });
        return;
      }
    }

    if (snap.expiresAt > nowMs()) {
      set({
        status: 'auth',
        phoneE164: snap.phoneNumber,
        tokenExpiresAt: snap.expiresAt,
        requestId: null,
        codeExpiresAt: null,
      });
      return;
    }

    // Expired and no refresh token usable.
    await secureTokenStore.clear();
    set({ status: 'guest', tokenExpiresAt: null, phoneE164: null });
  },

  sendCode: async (phoneE164, channel = 'sms') => {
    const ctrl = newController();
    set({ pending: true, lastError: null });
    try {
      const res = await authClient.sendCode({ phoneNumber: phoneE164, channel, signal: ctrl.signal });
      set({
        status: 'awaiting_code',
        phoneE164,
        requestId: res.requestId,
        codeExpiresAt: nowMs() + res.expiresIn * 1000,
        pending: false,
        lastError: null,
      });
      return true;
    } catch (err) {
      const error = err instanceof AuthApiError ? err : new AuthApiError('unknown', String(err));
      set({ pending: false, lastError: error });
      return false;
    }
  },

  resendCode: async (channel = 'sms') => {
    const { phoneE164 } = get();
    if (!phoneE164) return false;
    return get().sendCode(phoneE164, channel);
  },

  verifyCode: async (code) => {
    const { requestId, phoneE164 } = get();
    if (!requestId) {
      set({ lastError: new AuthApiError('request_not_found', 'no active code request') });
      return false;
    }
    const ctrl = newController();
    set({ pending: true, lastError: null });
    try {
      const res = await authClient.verifyCode({ requestId, code, signal: ctrl.signal });
      const expiresAt = nowMs() + res.expiresIn * 1000;
      await secureTokenStore.save({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt,
        phoneNumber: phoneE164,
      });
      set({
        status: 'auth',
        tokenExpiresAt: expiresAt,
        requestId: null,
        codeExpiresAt: null,
        pending: false,
        lastError: null,
      });
      return true;
    } catch (err) {
      const error = err instanceof AuthApiError ? err : new AuthApiError('unknown', String(err));
      set({ pending: false, lastError: error });
      return false;
    }
  },

  signOut: async () => {
    const snap = await secureTokenStore.load();
    if (snap?.accessToken) {
      try {
        await authClient.logout({
          accessToken: snap.accessToken,
          refreshToken: snap.refreshToken ?? undefined,
        });
      } catch {
        // Best-effort: still wipe locally on transport failure.
      }
    }
    await secureTokenStore.clear();
    set({
      status: 'guest',
      phoneE164: null,
      requestId: null,
      codeExpiresAt: null,
      tokenExpiresAt: null,
      lastError: null,
      pending: false,
    });
  },

  handleUnauthorized: async () => {
    await secureTokenStore.clear();
    set({
      status: 'guest',
      phoneE164: null,
      requestId: null,
      codeExpiresAt: null,
      tokenExpiresAt: null,
      lastError: new AuthApiError('unauthorized', 'session expired'),
      pending: false,
    });
  },
}));
