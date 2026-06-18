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
import { config } from '@/infrastructure/config';
import { relayClient } from '@/infrastructure/api/relayClient';
import { secureStore, SecureKeys } from '@/infrastructure/storage/secureStore';
import { secureTokenStore } from '@/infrastructure/storage/secure-token-store';

export type AuthStatus = 'initializing' | 'guest' | 'awaiting_code' | 'awaiting_2fa' | 'auth';

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
  verify2fa: (password: string) => Promise<boolean>;
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

function relayAuthEnabled(): boolean {
  return config.relayBase != null;
}

function relayError(code: string): AuthApiError {
  if (code === 'flood_wait') return new AuthApiError('rate_limited', '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (code === 'invalid_code') return new AuthApiError('invalid_code', '코드가 올바르지 않습니다.');
  if (code === 'expired') return new AuthApiError('code_expired', '코드가 만료되었습니다.');
  if (code === 'invalid_password') return new AuthApiError('invalid_password', '비밀번호가 올바르지 않습니다.');
  if (code === 'network') return new AuthApiError('network', 'relay에 연결할 수 없습니다.');
  if (code === 'no_relay') return new AuthApiError('network', 'relay 주소가 설정되지 않았습니다.');
  if (code === 'mtproto_disabled') return new AuthApiError('server', 'relay의 Telegram 로그인이 비활성화되어 있습니다.');
  return new AuthApiError('unknown', code);
}

async function saveRelaySession(phoneE164: string | null, tgUserId?: number): Promise<number> {
  const expiresAt = nowMs() + 365 * 24 * 60 * 60 * 1000;
  if (phoneE164) await secureStore.set(SecureKeys.phone, phoneE164);
  if (tgUserId != null) await secureStore.set(SecureKeys.tgUserId, String(tgUserId));
  await secureTokenStore.save({
    accessToken: `relay:${tgUserId ?? 'active'}`,
    refreshToken: null,
    expiresAt,
    phoneNumber: phoneE164,
  });
  return expiresAt;
}

async function clearRelaySession(): Promise<void> {
  await Promise.all([
    secureStore.remove(SecureKeys.tgUserId),
    secureStore.remove(SecureKeys.phone),
    secureStore.remove(SecureKeys.deviceSecret),
    secureStore.remove(SecureKeys.deviceId),
    secureTokenStore.clear(),
  ]);
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
    if (relayAuthEnabled()) {
      console.log('[auth] relay bootstrap start');
      const relayStatus = await relayClient.authStatus();
      if (relayStatus?.status === 'active' || relayStatus?.connected) {
        const phone = await secureStore.get(SecureKeys.phone);
        const expiresAt = await saveRelaySession(phone, relayStatus.tgUserId);
        console.log('[auth] relay bootstrap active');
        set({
          status: 'auth',
          phoneE164: phone,
          tokenExpiresAt: expiresAt,
          requestId: null,
          codeExpiresAt: null,
          lastError: null,
          pending: false,
        });
        return;
      }
      console.log('[auth] relay bootstrap guest');
      set({ status: 'guest', tokenExpiresAt: null, phoneE164: null, pending: false });
      return;
    }

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
      if (relayAuthEnabled()) {
        const res = await relayClient.authStart(phoneE164);
        if (!res.ok) throw relayError(res.error);
        set({
          status: 'awaiting_code',
          phoneE164,
          requestId: 'relay',
          codeExpiresAt: nowMs() + 300 * 1000,
          pending: false,
          lastError: null,
        });
        return true;
      }

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
      if (relayAuthEnabled()) {
        const res = await relayClient.authCode(code);
        if (!res.ok) throw relayError(res.error);
        if (res.needs2fa) {
          set({
            status: 'awaiting_2fa',
            pending: false,
            lastError: null,
          });
          return true;
        }
        const expiresAt = await saveRelaySession(phoneE164, res.tgUserId);
        set({
          status: 'auth',
          tokenExpiresAt: expiresAt,
          requestId: null,
          codeExpiresAt: null,
          pending: false,
          lastError: null,
        });
        return true;
      }

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

  verify2fa: async (password) => {
    const { phoneE164 } = get();
    set({ pending: true, lastError: null });
    try {
      if (!relayAuthEnabled()) throw new AuthApiError('server', '2FA is only available with relay auth');
      const res = await relayClient.auth2fa(password);
      if (!res.ok) throw relayError(res.error);
      const expiresAt = await saveRelaySession(phoneE164, res.tgUserId);
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
    if (relayAuthEnabled()) {
      try {
        await relayClient.authLogout();
      } catch {
        // Best-effort: still wipe locally on transport failure.
      }
      await clearRelaySession();
      set({
        status: 'guest',
        phoneE164: null,
        requestId: null,
        codeExpiresAt: null,
        tokenExpiresAt: null,
        lastError: null,
        pending: false,
      });
      return;
    }

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
    if (relayAuthEnabled()) await clearRelaySession();
    else await secureTokenStore.clear();
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
