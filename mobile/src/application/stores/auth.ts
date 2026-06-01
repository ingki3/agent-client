/**
 * Session store (single-user). Auth = Telegram **user-account** login (MTProto), driven
 * through the relay: phone → code → optional 2FA cloud password. The relay holds the
 * actual Telegram session; the app only keeps the relay deviceSecret (in relayClient) and
 * caches the logged-in tgUserId/phone for display + a fast ready-state on launch.
 *
 *   loading     — reading persisted state on splash
 *   onboarding  — not signed in → phone entry
 *   code        — code requested → code entry
 *   2fa         — cloud password required → 2FA entry
 *   ready       — signed in → main app
 */
import { create } from "zustand";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { kv } from "@/infrastructure/storage/kv";
import { relayClient } from "@/infrastructure/api/relayClient";

const INSTALL_FLAG = "install_flag_v3";

type SessionStatus = "loading" | "onboarding" | "code" | "2fa" | "ready";

type SessionState = {
  status: SessionStatus;
  phone: string | null;
  tgUserId: number | null;
  error: string | null;
  /** Whether the relay currently holds a live MTProto session (can send/receive). */
  connected: boolean;

  hydrate: () => Promise<void>;
  startLogin: (phone: string) => Promise<boolean>;
  submitCode: (code: string) => Promise<boolean>;
  submit2fa: (password: string) => Promise<boolean>;
  /** Re-poll the relay session connectivity (for the chat "connected" indicator). */
  refreshStatus: () => Promise<void>;
  reset: () => Promise<void>;
};

export const useAuthStore = create<SessionState>((set, get) => ({
  status: "loading",
  phone: null,
  tgUserId: null,
  error: null,
  connected: false,

  hydrate: async () => {
    // iOS Keychain survives reinstall while kv does not — on a fresh install purge any
    // orphaned credentials so we always start at onboarding.
    const installed = await kv.get<boolean>(INSTALL_FLAG);
    if (!installed) {
      await secureStore.remove(SecureKeys.tgUserId);
      await secureStore.remove(SecureKeys.phone);
      await secureStore.remove(SecureKeys.deviceSecret);
      await kv.set(INSTALL_FLAG, true);
      set({ status: "onboarding" });
      return;
    }

    const cachedId = await secureStore.get(SecureKeys.tgUserId);
    const phone = await secureStore.get(SecureKeys.phone);
    if (!cachedId) {
      set({ status: "onboarding" });
      return;
    }
    // Optimistically ready from cache, then confirm the relay still holds an active session.
    set({ status: "ready", tgUserId: Number(cachedId), phone });
    const remote = await relayClient.authStatus();
    if (remote && remote.status !== "active") {
      await secureStore.remove(SecureKeys.tgUserId);
      set({ status: "onboarding", tgUserId: null, connected: false });
    } else {
      set({ connected: !!remote?.connected });
    }
  },

  refreshStatus: async () => {
    const remote = await relayClient.authStatus();
    // null = relay unreachable → treat as not connected. Don't sign the user out on a
    // transient failure; only an explicit non-active status downgrades onboarding.
    set({ connected: !!remote?.connected });
    if (remote && remote.status !== "active" && get().status === "ready") {
      await secureStore.remove(SecureKeys.tgUserId);
      set({ status: "onboarding", tgUserId: null, connected: false });
    }
  },

  startLogin: async (phone) => {
    set({ error: null });
    const r = await relayClient.authStart(phone.trim());
    if (!r.ok) {
      set({ error: r.error });
      return false;
    }
    await secureStore.set(SecureKeys.phone, phone.trim());
    set({ status: "code", phone: phone.trim() });
    return true;
  },

  submitCode: async (code) => {
    set({ error: null });
    const r = await relayClient.authCode(code.trim());
    if (!r.ok) {
      set({ error: r.error });
      return false;
    }
    if (r.needs2fa) {
      set({ status: "2fa" });
      return true;
    }
    if (r.signedIn && r.tgUserId != null) {
      await secureStore.set(SecureKeys.tgUserId, String(r.tgUserId));
      set({ status: "ready", tgUserId: r.tgUserId, connected: true });
      return true;
    }
    set({ error: "unknown" });
    return false;
  },

  submit2fa: async (password) => {
    set({ error: null });
    const r = await relayClient.auth2fa(password);
    if (!r.ok || !r.signedIn || r.tgUserId == null) {
      set({ error: r.ok ? "unknown" : r.error });
      return false;
    }
    await secureStore.set(SecureKeys.tgUserId, String(r.tgUserId));
    set({ status: "ready", tgUserId: r.tgUserId, connected: true });
    return true;
  },

  reset: async () => {
    await relayClient.authLogout();
    await secureStore.remove(SecureKeys.tgUserId);
    await secureStore.remove(SecureKeys.phone);
    set({ status: "onboarding", phone: null, tgUserId: null, error: null, connected: false });
  },
}));
