/**
 * Session store (single-user). Replaces phone/OTP login with a one-time user id entry:
 * the user enters their Telegram user id (= chat_id for the bot conversation) once, and
 * it becomes the default address for every buddy — so sending works immediately without
 * waiting to "learn" the chat from an incoming message.
 *
 * Kept the `useAuthStore` name + `status` shape to limit churn; semantics:
 *   loading      — reading persisted state on splash
 *   onboarding   — no user id yet → show the user-id entry screen
 *   ready        — user id set → main app
 */
import { create } from "zustand";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { kv } from "@/infrastructure/storage/kv";

const INSTALL_FLAG = "install_flag_v2";

type SessionStatus = "loading" | "onboarding" | "ready";

type SessionState = {
  status: SessionStatus;
  userId: string | null; // Telegram user id / chat_id

  hydrate: () => Promise<void>;
  setUserId: (userId: string) => Promise<void>;
  reset: () => Promise<void>;
};

export const useAuthStore = create<SessionState>((set) => ({
  status: "loading",
  userId: null,

  hydrate: async () => {
    // iOS Keychain survives reinstall while kv does not — on a fresh install purge any
    // orphaned session id so we always start at onboarding.
    const installed = await kv.get<boolean>(INSTALL_FLAG);
    if (!installed) {
      await secureStore.remove(SecureKeys.userId);
      await kv.set(INSTALL_FLAG, true);
      set({ userId: null, status: "onboarding" });
      return;
    }
    const userId = await secureStore.get(SecureKeys.userId);
    set({ userId, status: userId ? "ready" : "onboarding" });
  },

  setUserId: async (userId) => {
    const id = userId.trim();
    await secureStore.set(SecureKeys.userId, id);
    set({ userId: id, status: "ready" });
  },

  reset: async () => {
    await secureStore.remove(SecureKeys.userId);
    set({ userId: null, status: "onboarding" });
  },
}));
