/**
 * Logout teardown: unregister from the relay + log the MTProto session out (best-effort,
 * inside the stores' reset()), then wipe all local state — buddies and chat history.
 */
import { useAuthStore } from "@/application/stores/auth";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useChatStore } from "@/application/stores/chat";
import { useTraceStore } from "@/application/stores/trace";
import { kv } from "@/infrastructure/storage/kv";

export async function signOut(): Promise<void> {
  await useBuddiesStore.getState().reset(); // removes bot tokens + per-buddy message kv
  await kv.clear();
  useTraceStore.getState().clear();
  useChatStore.setState({ byBuddy: {}, streamingMessageId: {} });
  await useAuthStore.getState().reset(); // clears user id + flips to onboarding
}
