/**
 * Auth store (TECH_SPEC §2.4). Drives the GUEST → AUTH state machine (USER_FLOW §1).
 * Token persists in SecureStore; everything else is in-memory session state.
 */
import { create } from "zustand";
import { authClient, AuthError } from "@/infrastructure/api/authClient";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";

type AuthStatus = "loading" | "guest" | "authed";

type AuthState = {
  status: AuthStatus;
  token: string | null;
  phone: string | null; // E.164
  requestId: string | null;
  devMode: boolean;
  devCodeHint: string;

  /** Read persisted token on splash (S-01) to decide GUEST vs AUTH. */
  hydrate: () => Promise<void>;
  sendCode: (phoneE164: string, channel?: "sms" | "voice") => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  token: null,
  phone: null,
  requestId: null,
  devMode: authClient.isDevMode,
  devCodeHint: authClient.devCodeHint,

  hydrate: async () => {
    const token = await secureStore.get(SecureKeys.authToken);
    const phone = await secureStore.get(SecureKeys.phoneNumber);
    set({ token, phone, status: token ? "authed" : "guest" });
  },

  sendCode: async (phoneE164, channel = "sms") => {
    const { requestId } = await authClient.sendCode(phoneE164, channel);
    set({ phone: phoneE164, requestId });
  },

  verifyCode: async (code) => {
    const { requestId, phone } = get();
    if (!requestId) throw new AuthError("unknown", "인증 요청이 만료되었습니다. 다시 시도해 주세요.");
    const { accessToken, refreshToken } = await authClient.verifyCode(requestId, code);
    await secureStore.set(SecureKeys.authToken, accessToken);
    if (refreshToken) await secureStore.set(SecureKeys.refreshToken, refreshToken);
    if (phone) await secureStore.set(SecureKeys.phoneNumber, phone);
    set({ token: accessToken, status: "authed" });
  },

  logout: async () => {
    const { token } = get();
    if (token) await authClient.logout(token);
    await secureStore.remove(SecureKeys.authToken);
    await secureStore.remove(SecureKeys.refreshToken);
    await secureStore.remove(SecureKeys.phoneNumber);
    set({ token: null, phone: null, requestId: null, status: "guest" });
  },
}));
