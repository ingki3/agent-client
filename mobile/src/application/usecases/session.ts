/**
 * Logout teardown (UC-01, TECH_SPEC §12.9): invalidate the session token (best-effort),
 * then wipe all local state — auth tokens, bot tokens, buddies, and chat history.
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
  await useAuthStore.getState().logout(); // clears auth token + flips to GUEST
}
