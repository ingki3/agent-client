/**
 * Logout teardown: log the auth session out (relay unregister + MTProto logout are
 * best-effort inside useAuthStore.signOut), then wipe all in-memory state — buddies
 * and chat history.
 */
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies-store";
import { useChatStore } from "@/application/stores/chat-store";
import { kv } from "@/infrastructure/storage/kv";

export async function signOut(): Promise<void> {
  useBuddiesStore.getState().reset();
  await kv.clear();
  useChatStore.getState().reset();
  await useAuthStore.getState().signOut(); // clears user id + flips to onboarding
}
