/**
 * Chat store (TECH_SPEC §2.4, §3.1). Owns the message timeline per buddy plus the
 * streaming/polling machinery.
 *
 * Two send paths:
 *  - mock buddy (no peer): canned reply re-emitted as a typewriter delta stream
 *    (FR-14) with an optional synthetic trace (FR-17~20).
 *  - live buddy (resolved peer): the relay sends the message AS THE USER (MTProto) to the
 *    target bot/peer, and the bot's replies arrive — as the counterpart ("agent") side —
 *    buffered by the relay and delivered via the relay-pull loop.
 *
 * Because the relay logs in as the human account (not a bot token), the user is the actual
 * sender; incoming messages from the peer are rendered as "agent" (see ingestUpdates).
 */
import { create } from "zustand";
import type { Message, MessageStatus } from "@/domain/entities";
import { uid } from "@/lib/id";
import { type TgUpdate } from "@/infrastructure/api/telegramBotApi";
import { relayClient } from "@/infrastructure/api/relayClient";
import { config } from "@/infrastructure/config";
import * as FileSystem from "expo-file-system";
import type { PickedAttachment } from "@/infrastructure/attachments";
import { simulateStream, type StreamEvent, type StreamHandle } from "@/infrastructure/api/traceStream";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { seedMessages, cannedReply, syntheticTrace } from "@/mock/seed";
import { receiveSource, setChatBridge } from "@/infrastructure/receive/ReceiveSource";
import { useBuddiesStore } from "./buddies";
import { useTraceStore } from "./trace";

const streamHandles = new Map<string, StreamHandle>();
// Safety timers that auto-clear a stuck "입력 중" indicator if no reply arrives.
const awaitTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Receive cursor per buddy (Telegram update_id / relay pull cursor), seeded from kv.
const offsets = new Map<string, number>();

type ChatState = {
  byBuddy: Record<string, Message[]>;
  streamingMessageId: Record<string, string | undefined>;
  /** Whether we're awaiting the agent's reply for a buddy (drives the "입력 중" indicator). */
  awaiting: Record<string, boolean>;

  hydrate: (buddyId: string) => Promise<void>;
  send: (buddyId: string, text: string, reply?: { messageId?: number; text: string }) => Promise<void>;
  /** Send one or more attachments as a single bubble (album) with an optional caption. */
  sendAttachments: (buddyId: string, picked: PickedAttachment[], caption?: string) => Promise<void>;
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

  const setAwaiting = (buddyId: string, on: boolean) => {
    const existing = awaitTimers.get(buddyId);
    if (existing) {
      clearTimeout(existing);
      awaitTimers.delete(buddyId);
    }
    if (on) {
      awaitTimers.set(
        buddyId,
        setTimeout(() => {
          awaitTimers.delete(buddyId);
          set((s) => ({ awaiting: { ...s.awaiting, [buddyId]: false } }));
        }, 120000),
      );
    }
    set((s) => ({ awaiting: { ...s.awaiting, [buddyId]: on } }));
  };

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

  const sendLive = async (buddyId: string, messageId: string, text: string, replyToId?: number) => {
    const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
    if (buddy?.botId == null) {
      setStatus(buddyId, messageId, "failed");
      persist(buddyId);
      return;
    }
    try {
      // The relay sends as the logged-in user (MTProto) to the peer (botId == peerId).
      const tgMsgId = await relayClient.sendAs(buddy.botId, text, messageId, replyToId);
      // Rewrite the optimistic message's id to the Telegram message id, so the same message
      // echoed back via the outgoing-sync /pull dedups instead of showing twice.
      set((s) => ({
        byBuddy: {
          ...s.byBuddy,
          [buddyId]: (s.byBuddy[buddyId] ?? []).map((m) =>
            m.id === messageId ? { ...m, id: `tg-${tgMsgId}`, status: "done" as const } : m,
          ),
        },
      }));
      touchBuddy(buddyId, text);
    } catch {
      setStatus(buddyId, messageId, "failed");
    }
    persist(buddyId);
  };

  return {
    byBuddy: {},
    streamingMessageId: {},
    awaiting: {},

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
      let gotIncoming = false;
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      for (const u of updates) {
        if (u.update_id + 1 > offset) offset = u.update_id + 1;
        const m = u.message ?? u.edited_message;
        if (!m?.text && !m?.media) continue;
        if (buddy && buddy.chatId == null) {
          useBuddiesStore.getState().update(buddyId, { chatId: m.chat.id });
          buddy.chatId = m.chat.id;
        }
        const id = `tg-${m.message_id}`;
        if (get().byBuddy[buddyId]?.some((x) => x.id === id)) continue;
        // `outgoing` = the user sent it (from any client) → render on the user side.
        const preview = m.preview
          ? {
              ...m.preview,
              // relay sends a relative /media path for the photo; make it absolute.
              image: m.preview.image ? `${config.relayBase ?? ""}${m.preview.image}` : undefined,
            }
          : undefined;
        const attachments = m.media
          ? [
              {
                kind: m.media.kind as "image" | "video" | "voice" | "audio" | "document",
                uri: `${config.relayBase ?? ""}${m.media.url}`,
                name: m.media.name,
                mime: m.media.mime,
                size: m.media.size,
              },
            ]
          : undefined;
        append(buddyId, {
          id,
          clientId: id,
          buddyId,
          role: m.outgoing ? "user" : "agent",
          text: m.text ?? "",
          createdAt: new Date(m.date * 1000).toISOString(),
          status: "done",
          preview,
          attachments,
        });
        touchBuddy(buddyId, m.text || (m.media ? `📎 ${m.media.name}` : ""), !m.outgoing);
        if (!m.outgoing) gotIncoming = true;
        persist(buddyId);
      }
      if (gotIncoming) setAwaiting(buddyId, false); // agent replied → hide "입력 중"
      offsets.set(buddyId, offset);
      void kv.set(KvKeys.offset(buddyId), offset);
      return offset;
    },

    send: async (buddyId, text, reply) => {
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
        replyTo: reply ? { messageId: reply.messageId, text: reply.text } : undefined,
      });
      persist(buddyId);

      if (buddy?.live) {
        await sendLive(buddyId, msgId, trimmed, reply?.messageId);
        setAwaiting(buddyId, true); // show "입력 중" until the agent replies
      } else {
        setStatus(buddyId, msgId, "done");
        streamMockReply(buddyId, trimmed);
      }
    },

    sendAttachments: async (buddyId, picked, caption) => {
      if (picked.length === 0) return;
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      const msgId = uid("u");
      const cap = caption?.trim() ?? "";
      append(buddyId, {
        id: msgId,
        clientId: msgId,
        buddyId,
        role: "user",
        text: cap,
        createdAt: new Date().toISOString(),
        status: "sending",
        attachments: picked.map((p) => ({
          kind: p.kind,
          uri: p.uri,
          name: p.name,
          mime: p.mime,
          size: p.size,
          durationMs: p.durationMs,
        })),
      });
      persist(buddyId);

      const labels: Record<string, string> = { image: "🖼 사진", video: "🎬 동영상", voice: "🎙 음성", audio: "🎵 오디오", document: "📎 파일" };
      if (buddy?.botId == null) {
        setStatus(buddyId, msgId, "failed");
        persist(buddyId);
        return;
      }
      try {
        const read = (uri: string) => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        let tgMsgId: number;
        if (picked.length === 1) {
          // Single item keeps its type-specific handling (voiceNote, document filename, …).
          const p = picked[0]!;
          tgMsgId = await relayClient.sendMedia(buddy.botId, {
            kind: p.kind,
            fileName: p.name,
            mime: p.mime,
            caption: cap || undefined,
            dataBase64: await read(p.uri),
          });
        } else {
          // Multiple → one Telegram album (single bubble).
          const files = await Promise.all(
            picked.map(async (p) => ({ kind: p.kind, fileName: p.name, mime: p.mime, dataBase64: await read(p.uri) })),
          );
          tgMsgId = await relayClient.sendMediaGroup(buddy.botId, files, cap || undefined);
        }
        set((s) => ({
          byBuddy: {
            ...s.byBuddy,
            [buddyId]: (s.byBuddy[buddyId] ?? []).map((m) =>
              m.id === msgId ? { ...m, id: `tg-${tgMsgId}`, status: "done" as const } : m,
            ),
          },
        }));
        touchBuddy(buddyId, picked.length > 1 ? `📎 첨부 ${picked.length}개` : labels[picked[0]!.kind] ?? "📎 첨부");
      } catch {
        setStatus(buddyId, msgId, "failed");
      }
      persist(buddyId);
    },

    retry: async (buddyId, messageId) => {
      const msg = get().byBuddy[buddyId]?.find((m) => m.id === messageId);
      if (!msg) return;
      setStatus(buddyId, messageId, "sending");
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (buddy?.live) {
        await sendLive(buddyId, messageId, msg.text, msg.replyTo?.messageId);
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

// Inject the chat store into ReceiveSource (one-directional: chat → ReceiveSource).
// Breaks the require cycle that an `import { useChatStore }` in ReceiveSource would create.
setChatBridge({
  currentOffset: (buddyId) => useChatStore.getState().currentOffset(buddyId),
  ingestUpdates: (buddyId, updates) => useChatStore.getState().ingestUpdates(buddyId, updates),
});
