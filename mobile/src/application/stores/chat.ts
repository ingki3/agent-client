/**
 * Chat store (TECH_SPEC §2.4, §3.1). Owns the message timeline per buddy plus the
 * streaming/polling machinery.
 *
 * Two send paths:
 *  - mock buddy (no token): canned reply re-emitted as a typewriter delta stream
 *    (FR-14) with an optional synthetic trace (FR-17~20).
 *  - live buddy (real bot token): `sendMessage` to the learned chat, and incoming
 *    replies arrive via a `getUpdates` long-poll loop.
 *
 * Telegram nuance: a bot token acts *as the bot*. `getUpdates` returns messages sent
 * TO the bot, so we render them as the counterpart ("agent") side and learn `chatId`
 * from the first one. An Agent Gateway routes app↔agent over the same surface.
 */
import { create } from "zustand";
import type { Message, MessageStatus } from "@/domain/entities";
import { uid } from "@/lib/id";
import { botApi, type TgUpdate } from "@/infrastructure/api/telegramBotApi";
import { simulateStream, type StreamEvent, type StreamHandle } from "@/infrastructure/api/traceStream";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { seedMessages, cannedReply, syntheticTrace } from "@/mock/seed";
import { receiveSource } from "@/infrastructure/receive/ReceiveSource";
import { useBuddiesStore } from "./buddies";
import { useTraceStore } from "./trace";

const streamHandles = new Map<string, StreamHandle>();
// Receive cursor per buddy (Telegram update_id / relay pull cursor), seeded from kv.
const offsets = new Map<string, number>();

type ChatState = {
  byBuddy: Record<string, Message[]>;
  streamingMessageId: Record<string, string | undefined>;

  hydrate: (buddyId: string) => Promise<void>;
  send: (buddyId: string, text: string) => Promise<void>;
  retry: (buddyId: string, messageId: string) => Promise<void>;
  stop: (buddyId: string) => void;
  startPolling: (buddyId: string) => Promise<void>;
  stopPolling: (buddyId: string) => void;
  /** Catch up missed messages (relay pull / on-open flush). No-op cost in poll mode. */
  catchUp: (buddyId: string) => Promise<void>;
  /** Current receive cursor for a buddy (seeded from kv). */
  currentOffset: (buddyId: string) => number;
  /**
   * Single dedupe authority: ingest Telegram-shaped updates (from poll, relay pull, or
   * push). Learns chatId, dedupes by message_id, appends, bumps unread, advances + persists
   * the offset cursor. Returns the new cursor.
   */
  ingestUpdates: (buddyId: string, updates: TgUpdate[]) => number;
};

export const useChatStore = create<ChatState>((set, get) => {
  const persist = (buddyId: string) => {
    void kv.set(KvKeys.messages(buddyId), get().byBuddy[buddyId] ?? []);
  };

  const append = (buddyId: string, msg: Message) =>
    set((s) => ({ byBuddy: { ...s.byBuddy, [buddyId]: [...(s.byBuddy[buddyId] ?? []), msg] } }));

  const patch = (buddyId: string, messageId: string, p: Partial<Message>) =>
    set((s) => ({
      byBuddy: {
        ...s.byBuddy,
        [buddyId]: (s.byBuddy[buddyId] ?? []).map((m) => (m.id === messageId ? { ...m, ...p } : m)),
      },
    }));

  const appendDelta = (buddyId: string, messageId: string, chunk: string) =>
    set((s) => ({
      byBuddy: {
        ...s.byBuddy,
        [buddyId]: (s.byBuddy[buddyId] ?? []).map((m) =>
          m.id === messageId ? { ...m, text: m.text + chunk } : m,
        ),
      },
    }));

  const setStatus = (buddyId: string, messageId: string, status: MessageStatus) =>
    patch(buddyId, messageId, { status });

  const touchBuddy = (buddyId: string, preview: string, bumpUnread = false) => {
    const buddiesStore = useBuddiesStore.getState();
    const buddy = buddiesStore.buddies.find((b) => b.id === buddyId);
    buddiesStore.update(buddyId, {
      lastMessagePreview: preview.slice(0, 80),
      lastMessageAt: new Date().toISOString(),
      unread: bumpUnread ? (buddy?.unread ?? 0) + 1 : 0,
    });
  };

  const streamMockReply = (buddyId: string, userText: string) => {
    const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
    const replyId = uid("a");
    const supportsTrace = buddy?.supportsTrace ?? false;
    append(buddyId, {
      id: replyId,
      clientId: replyId,
      buddyId,
      role: "agent",
      text: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
      traceId: supportsTrace ? `trace-${replyId}` : undefined,
    });
    set((s) => ({ streamingMessageId: { ...s.streamingMessageId, [buddyId]: replyId } }));

    const onEvent = (e: StreamEvent) => {
      const trace = useTraceStore.getState();
      switch (e.type) {
        case "delta":
          appendDelta(buddyId, replyId, e.text);
          break;
        case "thinking":
          trace.appendNode(replyId, {
            kind: "thinking",
            payload: { step: e.step, summary: e.summary, content: e.content },
          });
          break;
        case "tool_call":
          trace.appendNode(replyId, {
            kind: "tool_call",
            startedAt: e.startedAt,
            payload: { id: e.id, name: e.name, args: e.args },
          });
          break;
        case "tool_result":
          trace.appendNode(replyId, {
            kind: "tool_result",
            latencyMs: e.latencyMs,
            payload: { id: e.id, status: e.status, preview: e.preview },
          });
          break;
        case "done": {
          const summary = trace.summarize(replyId);
          patch(buddyId, replyId, { status: "done", traceSummary: summary });
          set((s) => ({ streamingMessageId: { ...s.streamingMessageId, [buddyId]: undefined } }));
          streamHandles.delete(buddyId);
          const finalText = get().byBuddy[buddyId]?.find((m) => m.id === replyId)?.text ?? "";
          touchBuddy(buddyId, finalText);
          persist(buddyId);
          break;
        }
        case "error":
          setStatus(buddyId, replyId, "failed");
          break;
      }
    };

    const handle = simulateStream(cannedReply(userText), onEvent, {
      trace: supportsTrace ? syntheticTrace() : undefined,
    });
    streamHandles.set(buddyId, handle);
  };

  const sendLive = async (buddyId: string, messageId: string, text: string) => {
    const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
    const token = await secureStore.get(SecureKeys.botToken(buddyId));
    if (!token || buddy?.chatId == null) {
      // chatId is learned from the first incoming update; until then we can't address it.
      setStatus(buddyId, messageId, "failed");
      persist(buddyId);
      return;
    }
    try {
      await botApi.sendChatAction(token, buddy.chatId).catch(() => undefined);
      await botApi.sendMessage(token, buddy.chatId, text);
      setStatus(buddyId, messageId, "done");
      touchBuddy(buddyId, text);
    } catch {
      setStatus(buddyId, messageId, "failed");
    }
    persist(buddyId);
  };

  return {
    byBuddy: {},
    streamingMessageId: {},

    hydrate: async (buddyId) => {
      if (offsets.get(buddyId) == null) {
        offsets.set(buddyId, (await kv.get<number>(KvKeys.offset(buddyId))) ?? 0);
      }
      if (get().byBuddy[buddyId]) return;
      const stored = await kv.get<Message[]>(KvKeys.messages(buddyId));
      const initial = stored ?? seedMessages[buddyId] ?? [];
      set((s) => ({ byBuddy: { ...s.byBuddy, [buddyId]: initial } }));
      if (!stored && seedMessages[buddyId]) persist(buddyId);
    },

    currentOffset: (buddyId) => offsets.get(buddyId) ?? 0,

    ingestUpdates: (buddyId, updates) => {
      let offset = offsets.get(buddyId) ?? 0;
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      for (const u of updates) {
        if (u.update_id + 1 > offset) offset = u.update_id + 1;
        const m = u.message ?? u.edited_message;
        if (!m?.text) continue;
        if (buddy && buddy.chatId == null) {
          useBuddiesStore.getState().update(buddyId, { chatId: m.chat.id });
          buddy.chatId = m.chat.id;
        }
        const id = `tg-${m.message_id}`;
        if (get().byBuddy[buddyId]?.some((x) => x.id === id)) continue;
        append(buddyId, {
          id,
          clientId: id,
          buddyId,
          role: "agent",
          text: m.text,
          createdAt: new Date(m.date * 1000).toISOString(),
          status: "done",
        });
        touchBuddy(buddyId, m.text, true);
        persist(buddyId);
      }
      offsets.set(buddyId, offset);
      void kv.set(KvKeys.offset(buddyId), offset);
      return offset;
    },

    send: async (buddyId, text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      const msgId = uid("u");
      append(buddyId, {
        id: msgId,
        clientId: msgId,
        buddyId,
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
        status: "sending",
      });
      persist(buddyId);

      if (buddy?.live) {
        await sendLive(buddyId, msgId, trimmed);
      } else {
        setStatus(buddyId, msgId, "done");
        streamMockReply(buddyId, trimmed);
      }
    },

    retry: async (buddyId, messageId) => {
      const msg = get().byBuddy[buddyId]?.find((m) => m.id === messageId);
      if (!msg) return;
      setStatus(buddyId, messageId, "sending");
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (buddy?.live) {
        await sendLive(buddyId, messageId, msg.text);
      } else {
        setStatus(buddyId, messageId, "done");
        streamMockReply(buddyId, msg.text);
      }
    },

    stop: (buddyId) => {
      streamHandles.get(buddyId)?.close();
      streamHandles.delete(buddyId);
      const streamingId = get().streamingMessageId[buddyId];
      if (streamingId) {
        const summary = useTraceStore.getState().summarize(streamingId);
        patch(buddyId, streamingId, { status: "done", traceSummary: summary });
      }
      set((s) => ({ streamingMessageId: { ...s.streamingMessageId, [buddyId]: undefined } }));
      persist(buddyId);
    },

    // Receive is delegated to the ReceiveSource port: TelegramPollSource (direct
    // getUpdates, when no relay) or RelayPullSource (pulls from the relay; the relay is
    // then the sole Telegram consumer + sends push). Both funnel through ingestUpdates.
    startPolling: async (buddyId) => {
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (!buddy?.live) return;
      await receiveSource.start(buddyId);
    },

    stopPolling: (buddyId) => {
      receiveSource.stop(buddyId);
    },

    catchUp: async (buddyId) => {
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (!buddy?.live) return;
      await receiveSource.catchUp(buddyId);
    },
  };
});
