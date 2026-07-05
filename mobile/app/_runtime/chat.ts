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
import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useChatStore } from '@/application/stores/chat-store';
import { useNetworkStore } from '@/application/stores/network-store';
import {
  type ChatBotTokenPort,
  type ChatUseCaseDeps,
  deleteMessage as deleteMessageUseCase,
  flushOutbox as flushOutboxUseCase,
  listMessages as listMessagesUseCase,
  persistLocalDisplayMessage,
  persistRemoteMessage,
  receiveUpdates as receiveUpdatesUseCase,
  retryMessage as retryMessageUseCase,
  sendMessage as sendMessageUseCase,
} from '@/application/usecases/chat';
import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';
import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import { relayClient, type RelayStreamHandle } from '@/infrastructure/api/relayClient';
import { readBase64, type PickedAttachment } from '@/infrastructure/attachments';
import { createExpoSqliteDatabase } from '@/infrastructure/storage/adapters/expo-sqlite-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { uid } from '@/lib/id';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessageSyncStateRepository } from '@/infrastructure/storage/repositories/message-sync-state-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';

const DEFAULT_GATEWAY = 'https://api.telegram.org';
const SQLITE_FILENAME = 'agentclient.db';
const POLL_INTERVAL_MS = 7_000;

let initialized = false;
let depsRef: ChatUseCaseDeps | null = null;
let bootedOffsets: Record<BuddyId, number> = {};
const activePolls: Record<BuddyId, ReturnType<typeof setTimeout> | null> = {};
const activeStreams: Record<BuddyId, RelayStreamHandle | null> = {};
const pendingStreams = new Set<BuddyId>();

function getDeps(): ChatUseCaseDeps {
  if (!depsRef) {
    throw new Error('Chat runtime not initialized — call initChatRuntime() first.');
  }
  return depsRef;
}

/**
 * Monotonic advance for the in-memory cursor. The stream and the poll loop race
 * (an in-flight poll can finish after stream events already advanced the
 * cursor), so plain assignment would rewind and re-fetch processed messages.
 * Do NOT replace bootedOffsets with the repo cursor: the legacy bot-token
 * getUpdates path never persists to message_sync_state, so this map is its
 * only offset memory.
 */
function advanceBootedOffset(buddyId: BuddyId, cursor: number): void {
  bootedOffsets[buddyId] = Math.max(bootedOffsets[buddyId] ?? 0, cursor);
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
    messageSyncStateRepo: new MessageSyncStateRepository(db),
    messagesRepo: new MessagesRepository(db),
    outboxRepo: new OutboxRepository(db),
    tokenStore,
    botApi: new BotApiClient({ gateway: DEFAULT_GATEWAY }),
    relaySendMessage: (peerId, text, clientTag) => relayClient.sendAs(peerId, text, clientTag),
    relaySyncMessages: (peerId, sinceUpdateId, limit) => relayClient.syncMessages(peerId, sinceUpdateId, limit),
    relaySyncMessageSnapshots: (peerId, sinceCursor, limit) => relayClient.syncMessageSnapshots(peerId, sinceCursor, limit),
    // uid(), not uuid: uuid v4 needs crypto.getRandomValues, which Hermes
    // release builds lack without a native polyfill — it threw on every text
    // send once the screen stopped supplying its own clientMessageId.
    newClientMessageId: () => uid('msg'),
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

/**
 * Self-heal on chat entry: fetch the relay's most recent snapshots regardless of
 * the local sync cursor, persist any we're missing, and re-hydrate the display.
 * Recovers messages stranded when the sync cursor drifted ahead of them (a live
 * stream event / streaming-message cursor bump can leapfrog earlier messages,
 * and the monotonic cursor never rewinds to re-fetch them).
 */
export async function backfillRecentMessagesFlow(buddyId: BuddyId): Promise<void> {
  const deps = getDeps();
  const peerId = Number(buddyId);
  if (!Number.isFinite(peerId)) return;
  const snapshots = await relayClient.fetchRecentMessages(peerId, 50);
  let inserted = 0;
  for (const snapshot of snapshots) {
    if (String(snapshot.peerId) !== buddyId) continue;
    try {
      const persisted = persistRemoteMessage(deps, snapshot);
      if (persisted) {
        useChatStore.getState().appendMessage(persisted);
        inserted += 1;
      }
    } catch {
      // best-effort; skip a snapshot that fails to persist
    }
  }
  // Rebuild the ordered view from SQLite so backfilled messages land in order.
  if (inserted > 0) hydrateChatScreen(buddyId);
}

export function markBuddyRead(buddyId: BuddyId): void {
  // Called on every stream event — skip the SQLite write when the store
  // already shows the buddy as read. Falls through when the buddy is not
  // hydrated in the store (correctness over savings).
  const current = useBuddiesStore.getState().buddies[buddyId];
  if (current && current.unreadCount === 0) return;
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

/**
 * Shared attachment-send lifecycle: optimistic local message (insert + append),
 * offline short-circuit, then the relay send + status reconciliation. The only
 * thing that differs between a single attachment and a group is the relay call,
 * which the caller supplies as `send`.
 */
async function sendAttachmentsCommon(
  buddyId: BuddyId,
  attachments: PickedAttachment[],
  caption: string,
  send: (peerId: number, caption: string) => Promise<number>,
): Promise<Message> {
  const deps = getDeps();
  const createdAt = deps.now();
  const clientMessageId = `local-media-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
  const text = caption.trim();
  const message: Message = {
    id: null,
    clientMessageId,
    buddyId,
    role: 'user',
    text,
    status: useNetworkStore.getState().isOnline ? 'sending' : 'failed',
    createdAt,
    traceId: null,
    attachments: attachments.map((attachment) => ({
      kind: attachment.kind,
      uri: attachment.uri,
      name: attachment.name,
      mime: attachment.mime,
      ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    })),
  };

  deps.db.transaction(() => {
    deps.messagesRepo.insert(message);
  });
  useChatStore.getState().appendMessage(message);

  const peerId = Number(buddyId);
  if (!useNetworkStore.getState().isOnline || !Number.isFinite(peerId)) {
    useChatStore.getState().setStatus(clientMessageId, 'failed');
    return { ...message, status: 'failed' };
  }

  try {
    const messageId = await send(peerId, text);
    deps.db.transaction(() => {
      // adoptServerId: tolerant of the echo row landing first (PK conflict).
      deps.messagesRepo.adoptServerId(clientMessageId, String(messageId));
    });
    useChatStore.getState().setServerId(clientMessageId, String(messageId));
    useChatStore.getState().setStatus(clientMessageId, 'sent');
    return { ...message, id: String(messageId), status: 'sent' };
  } catch (err) {
    console.warn('[chat] sendAttachments failed', {
      buddyId,
      count: attachments.length,
      error: err instanceof Error ? err.message : String(err),
    });
    deps.db.transaction(() => {
      deps.messagesRepo.updateStatus(clientMessageId, 'failed');
    });
    useChatStore.getState().setStatus(clientMessageId, 'failed');
    return { ...message, status: 'failed' };
  }
}

export async function sendAttachmentFlow(
  buddyId: BuddyId,
  attachment: PickedAttachment,
  caption = '',
): Promise<Message> {
  return sendAttachmentsCommon(buddyId, [attachment], caption, async (peerId, text) => {
    const dataBase64 = await readBase64(attachment.uri, attachment.name);
    const payload = {
      kind: attachment.kind,
      fileName: attachment.name,
      mime: attachment.mime,
      dataBase64,
    };
    return relayClient.sendMedia(peerId, text ? { ...payload, caption: text } : payload);
  });
}

export async function sendAttachmentGroupFlow(
  buddyId: BuddyId,
  attachments: PickedAttachment[],
  caption = '',
): Promise<Message> {
  if (attachments.length === 0) {
    throw new Error('sendAttachmentGroupFlow: empty attachments are not allowed');
  }
  if (attachments.length === 1) {
    return sendAttachmentFlow(buddyId, attachments[0]!, caption);
  }

  return sendAttachmentsCommon(buddyId, attachments, caption, async (peerId, text) => {
    const files = await Promise.all(
      attachments.map(async (attachment) => ({
        kind: attachment.kind,
        fileName: attachment.name,
        mime: attachment.mime,
        dataBase64: await readBase64(attachment.uri, attachment.name),
      })),
    );
    return relayClient.sendMediaGroup(peerId, files, text || undefined);
  });
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
      const offset = bootedOffsets[buddyId] ?? deps.messageSyncStateRepo.getCursor(buddyId);
      const outcome = await receiveUpdatesUseCase(deps, { buddyId, offset });
      advanceBootedOffset(buddyId, outcome.newOffset);
      for (const msg of outcome.inserted) {
        useChatStore.getState().appendMessage(msg);
      }
      startRelayStream(buddyId, outcome.newOffset);
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
    stopRelayStream(buddyId);
  };
}

function startRelayStream(buddyId: BuddyId, sinceCursor: number): void {
  if (activeStreams[buddyId] || pendingStreams.has(buddyId)) return;
  const deps = getDeps();
  const peerId = Number(buddyId);
  if (!Number.isFinite(peerId)) return;
  pendingStreams.add(buddyId);
  // Set when the stream dies before openMessageStream resolves, so the .then
  // below never registers (and closes) an already-dead handle.
  let dead = false;
  void relayClient.openMessageStream(peerId, sinceCursor, (event) => {
    if (event.type === 'closed') {
      // Stream died (server end / network error / rotation). Drop the handle so
      // the next poll tick (≤7s) reopens it at the current cursor; the relay
      // replays a snapshot backlog on reconnect and persistRemoteMessage
      // de-dupes, so nothing is lost in the gap.
      dead = true;
      stopRelayStream(buddyId);
      return;
    }
    if (event.type !== 'message_updated' && event.type !== 'helper_updated') return;
    // Persist + surface BOTH directions: agent replies and the user's own
    // messages sent from another Telegram client (role === 'user'). The old
    // agent-only guard dropped those, so cross-client messages never appeared
    // live and the advancing cursor then skipped them on the next poll too.
    // persistRemoteMessage de-dupes by server id, so our own local echo is not
    // re-appended.
    const persisted = persistRemoteMessage(deps, event.message);
    if (!persisted) return;
    useChatStore.getState().appendMessage(persisted);
    advanceBootedOffset(buddyId, event.message.cursor);
    markBuddyRead(buddyId);
  }).then((handle) => {
    pendingStreams.delete(buddyId);
    if (!handle) return;
    if (dead || !activePolls[buddyId]) {
      handle.close();
      return;
    }
    activeStreams[buddyId] = handle;
  }).catch(() => {
    pendingStreams.delete(buddyId);
  });
}

function stopRelayStream(buddyId: BuddyId): void {
  pendingStreams.delete(buddyId);
  const handle = activeStreams[buddyId];
  if (handle) {
    handle.close();
    activeStreams[buddyId] = null;
  }
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

export function appendLocalDisplayMessageFlow(
  buddyId: BuddyId,
  text: string,
  role: Message['role'] = 'user',
): Message {
  const message = persistLocalDisplayMessage(getDeps(), { buddyId, text, role });
  useChatStore.getState().appendMessage(message);
  return message;
}

/** Test/QA helper — reset all in-process state so a fresh init() can rewire. */
export function _resetChatRuntime(): void {
  initialized = false;
  depsRef = null;
  bootedOffsets = {};
  for (const id of Object.keys(activePolls)) {
    stopPolling(id);
  }
  for (const id of Object.keys(activeStreams)) {
    stopRelayStream(id);
  }
}
