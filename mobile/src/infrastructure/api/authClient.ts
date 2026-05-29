/**
 * Auth API client — Telegram-standard phone + SMS flow (PRD §5.3, TECH_SPEC §3.5).
 *
 *   POST /v1/auth/send-code   { phone_number, channel } -> { request_id, expires_in }
 *   POST /v1/auth/verify-code { request_id, code }      -> { access_token, refresh_token? }
 *   POST /v1/auth/logout      (Bearer)                  -> 204
 *
 * When no Agent Gateway is configured (`config.apiBase == null`) we run in DEV mode:
 * any well-formed phone number gets a code request, and the fixed code "000000"
 * (or any 6 digits in dev) verifies. This keeps the full S-02/S-03 UX runnable
 * without a backend; wiring a real gateway requires no UI change.
 */
import { config, hasBackend } from "../config";

export type SendCodeResult = { requestId: string; expiresIn: number };
export type VerifyResult = { accessToken: string; refreshToken?: string };

export class AuthError extends Error {
  constructor(
    public reason: "invalid_code" | "expired" | "too_many_attempts" | "network" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const DEV_CODE = "000000";

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new AuthError("invalid_code", "코드가 올바르지 않습니다.");
    if (res.status === 410) throw new AuthError("expired", "인증 코드가 만료되었습니다.");
    if (res.status === 429) throw new AuthError("too_many_attempts", "시도 횟수를 초과했습니다.");
    throw new AuthError("unknown", `요청 실패 (${res.status})`);
  }
  return (await res.json()) as T;
}

export const authClient = {
  isDevMode: !hasBackend,
  devCodeHint: DEV_CODE,

  async sendCode(phoneE164: string, channel: "sms" | "voice" = "sms"): Promise<SendCodeResult> {
    if (!hasBackend) {
      // DEV mode: pretend a code was sent.
      return { requestId: `dev-${phoneE164}`, expiresIn: 300 };
    }
    try {
      return await post<SendCodeResult>("/v1/auth/send-code", {
        phone_number: phoneE164,
        channel,
      });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError("network", "네트워크 오류가 발생했습니다.");
    }
  },

  async verifyCode(requestId: string, code: string): Promise<VerifyResult> {
    if (!hasBackend) {
      // DEV mode: accept the hint code, or any 6-digit code, to keep testing frictionless.
      if (code === DEV_CODE || /^\d{6}$/.test(code)) {
        return { accessToken: `dev-token-${requestId}`, refreshToken: `dev-refresh-${requestId}` };
      }
      throw new AuthError("invalid_code", "6자리 코드를 입력해 주세요.");
    }
    try {
      const r = await post<{ access_token: string; refresh_token?: string }>(
        "/v1/auth/verify-code",
        { request_id: requestId, code },
      );
      return { accessToken: r.access_token, refreshToken: r.refresh_token };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError("network", "네트워크 오류가 발생했습니다.");
    }
  },

  async logout(token: string): Promise<void> {
    if (!hasBackend) return;
    try {
      await post("/v1/auth/logout", {}, token);
    } catch {
      // best-effort — local teardown happens regardless (TECH_SPEC §12.9)
    }
  },
};
