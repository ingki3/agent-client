/**
 * Chat composition root — wires `ChatUseCaseDeps` to concrete adapters and
 * exposes high-level flow helpers + lifecycle hooks for `(main)/chat/[id]`.
 *
 * Lives under `app/` (not `src/application`) because the layer rule (TECH §2.3)
 * forbids application from importing infrastructure directly (see .eslintrc).
 *
 * BIZ-265 owns `bot-token-store.ts`. We import via a structural port to keep this
 * file compilable before that PR lands; the port resolves to the real adapter
 * once BIZ-265 merges (same file path, no rename).
 */
import { v4 as uuidv4 } from 'uuid';

import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useChatStore } from '@/application/stores/chat-store';
import { useNetworkStore } from '@/application/stores/network-store';
import {
  type ChatBotTokenPort,
  type ChatUseCaseDeps,
  deleteMessage as deleteMessageUseCase,
  flushOutbox as flushOutboxUseCase,
  listMessages as listMessagesUseCase,
  receiveUpdates as receiveUpdatesUseCase,
  retryMessage as retryMessageUseCase,
  sendMessage as sendMessageUseCase,
} from '@/application/usecases/chat';
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';
import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import { relayClient } from '@/infrastructure/api/relayClient';
import { createExpoSqliteDatabase } from '@/infrastructure/storage/adapters/expo-sqlite-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';

const DEFAULT_GATEWAY = 'https://api.telegram.org';
const SQLITE_FILENAME = 'agentclient.db';
const POLL_INTERVAL_MS = 7_000;

let initialized = false;
let depsRef: ChatUseCaseDeps | null = null;
let bootedOffsets: Record<BuddyId, number> = {};
const activePolls: Record<BuddyId, ReturnType<typeof setTimeout> | null> = {};

function getDeps(): ChatUseCaseDeps {
  if (!depsRef) {
    throw new Error('Chat runtime not initialized — call initChatRuntime() first.');
  }
  return depsRef;
}

/**
 * Idempotent cold-start wiring. Safe to call from every chat-related screen's
 * useEffect — the DB open + migrations + bot-token adapter resolve run only once.
 */
export function initChatRuntime(): void {
  if (initialized) return;
  initialized = true;

  const db: Database = createExpoSqliteDatabase(SQLITE_FILENAME);
  applyMigrations(db);
  const tokenStore = loadBotTokenStore();

  depsRef = {
    db,
    buddiesRepo: new BuddiesRepository(db),
    messagesRepo: new MessagesRepository(db),
    outboxRepo: new OutboxRepository(db),
    tokenStore,
    botApi: new BotApiClient({ gateway: DEFAULT_GATEWAY }),
    relaySendMessage: (peerId, text, clientTag) => relayClient.sendAs(peerId, text, clientTag),
    relaySyncMessages: (peerId, sinceUpdateId, limit) => relayClient.syncMessages(peerId, sinceUpdateId, limit),
    newClientMessageId: () => uuidv4(),
    now: () => Date.now(),
  };
}

/**
 * Resolve the per-buddy bot-token adapter. BIZ-265 ships
 * `@/infrastructure/storage/bot-token-store` and we consume it via the
 * structural port. We require() at runtime so this file compiles even when
 * the PR hasn't landed yet — a temporary stub is used until then.
 */
function loadBotTokenStore(): ChatBotTokenPort {
  try {

    const mod = require('@/infrastructure/storage/bot-token-store') as {
      botTokenStore: ChatBotTokenPort;
    };
    return mod.botTokenStore;
  } catch {
    // Pre-BIZ-265 fallback — composition root logs and reads return null so the
    // app surfaces a friendly "no token" UX instead of crashing.
    return {
      async load(_id) {
        return null;
      },
    };
  }
}

/**
 * S-11 진입 — SQLite history → useChatStore. Also self-rehydrates the buddy
 * into useBuddiesStore when the user arrives via a deep-link without first
 * passing through S-10 (which is what runs BIZ-265's initBuddiesRuntime).
 */
export function hydrateChatScreen(buddyId: BuddyId): Message[] {
  const deps = getDeps();
  const buddy = deps.buddiesRepo.findById(buddyId);
  if (buddy) useBuddiesStore.getState().upsert(buddy);
  const history = listMessagesUseCase(deps, { buddyId });
  useChatStore.getState().setBuddyMessages(buddyId, history);
  return history;
}

export function markBuddyRead(buddyId: BuddyId): void {
  const deps = getDeps();
  deps.buddiesRepo.markRead(buddyId);
  useBuddiesStore.getState().markRead(buddyId);
}

export async function sendMessageFlow(
  buddyId: BuddyId,
  text: string,
  options: { clientMessageId?: string; createdAt?: number } = {},
): Promise<Awaited<ReturnType<typeof sendMessageUseCase>>> {
  const deps = getDeps();
  const isOnline = useNetworkStore.getState().isOnline;
  let appended = false;
  const input: Parameters<typeof sendMessageUseCase>[1] = {
    buddyId,
    text,
    isOnline,
    onPersisted: (message) => {
      appended = true;
      useChatStore.getState().appendMessage(message);
    },
  };
  if (options.clientMessageId !== undefined) input.clientMessageId = options.clientMessageId;
  if (options.createdAt !== undefined) input.createdAt = options.createdAt;
  const outcome = await sendMessageUseCase(deps, input);
  if (!appended) {
    useChatStore.getState().appendMessage(outcome.message);
  }
  if (outcome.kind === 'sent') {
    useChatStore.getState().setStatus(outcome.message.clientMessageId, 'sent');
    useChatStore.getState().setServerId(
      outcome.message.clientMessageId,
      outcome.serverMessageId,
    );
  } else if (outcome.kind === 'failed') {
    useChatStore.getState().setStatus(outcome.message.clientMessageId, 'failed');
  }
  refreshPendingOutboxCount();
  return outcome;
}

export async function retryMessageFlow(
  clientMessageId: string,
): Promise<Awaited<ReturnType<typeof retryMessageUseCase>>> {
  const deps = getDeps();
  const isOnline = useNetworkStore.getState().isOnline;
  const outcome = await retryMessageUseCase(deps, { clientMessageId, isOnline });
  if (outcome.kind === 'sent') {
    useChatStore.getState().setStatus(clientMessageId, 'sent');
    useChatStore.getState().setServerId(clientMessageId, outcome.serverMessageId);
  } else if (outcome.kind === 'failed') {
    useChatStore.getState().setStatus(clientMessageId, 'failed');
  } else {
    useChatStore.getState().setStatus(clientMessageId, 'queued');
  }
  refreshPendingOutboxCount();
  return outcome;
}

export async function deleteMessageFlow(clientMessageId: string): Promise<void> {
  await deleteMessageUseCase(getDeps(), { clientMessageId });
  refreshPendingOutboxCount();
  // Caller (screen) re-hydrates the store from SQLite for simplicity. Avoids
  // having to extend useChatStore with a per-message remove() purely for this flow.
}

export async function flushOutboxFlow(): Promise<void> {
  const deps = getDeps();
  if (!useNetworkStore.getState().isOnline) return;
  const outcome = await flushOutboxUseCase(deps);
  for (const id of outcome.sent) {
    const persisted = deps.messagesRepo.findByClientMessageId(id);
    if (persisted) {
      useChatStore.getState().setStatus(id, 'sent');
      if (persisted.id) useChatStore.getState().setServerId(id, persisted.id);
    }
  }
  for (const id of outcome.giveUp) {
    useChatStore.getState().setStatus(id, 'failed');
  }
  refreshPendingOutboxCount();
}

/**
 * Start a `getUpdates` polling loop for one buddy. Returns a stop fn; safe to
 * call multiple times — second call no-ops if a poll is already active for
 * the buddy. (S-11 mount/unmount.)
 */
export function startPolling(buddyId: BuddyId): () => void {
  const deps = getDeps();
  if (activePolls[buddyId]) {
    return () => stopPolling(buddyId);
  }

  let cancelled = false;
  const tick = async () => {
    if (cancelled) return;
    if (!useNetworkStore.getState().isOnline) {
      activePolls[buddyId] = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }
    try {
      const offset = bootedOffsets[buddyId] ?? 0;
      const outcome = await receiveUpdatesUseCase(deps, { buddyId, offset });
      bootedOffsets[buddyId] = outcome.newOffset;
      for (const msg of outcome.inserted) {
        useChatStore.getState().appendMessage(msg);
      }
      if (outcome.inserted.length > 0) {
        markBuddyRead(buddyId);
      }
    } catch {
      // Swallow — polling is best-effort; next tick will try again.
    }
    if (!cancelled) {
      activePolls[buddyId] = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  activePolls[buddyId] = setTimeout(tick, 0);
  return () => {
    cancelled = true;
    stopPolling(buddyId);
  };
}

function stopPolling(buddyId: BuddyId): void {
  const handle = activePolls[buddyId];
  if (handle) {
    clearTimeout(handle);
    activePolls[buddyId] = null;
  }
}

export function refreshPendingOutboxCount(): void {
  const count = getDeps().outboxRepo.count();
  useNetworkStore.getState().setPendingOutboxCount(count);
}

/** Test/QA helper — reset all in-process state so a fresh init() can rewire. */
export function _resetChatRuntime(): void {
  initialized = false;
  depsRef = null;
  bootedOffsets = {};
  for (const id of Object.keys(activePolls)) {
    stopPolling(id);
  }
}
