import { create } from 'zustand';

import type { BuddyId } from '@/domain/entities/Buddy';
import type {
  ClientMessageId,
  Message,
  MessageTts,
  MessageStatus,
  ServerMessageId,
} from '@/domain/entities/Message';
import { isLikelyDuplicateMessage } from '@/domain/messages/duplicateMessages';
import { isHiddenHelperSubmitMessage } from '@/domain/messages/hiddenMessages';

function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function sameMessage(a: Message, b: Message): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

interface ChatState {
  /** buddyId -> ordered clientMessageId 배열. 화면 키는 clientMessageId (TECH §12.3). */
  byBuddy: Record<BuddyId, ClientMessageId[]>;
  /** clientMessageId -> Message. SQLite 영속 데이터의 메모리 미러. */
  messages: Record<ClientMessageId, Message>;
  setBuddyMessages: (buddyId: BuddyId, messages: Message[]) => void;
  appendMessage: (msg: Message) => void;
  setStatus: (clientMessageId: ClientMessageId, status: MessageStatus) => void;
  setServerId: (clientMessageId: ClientMessageId, serverId: ServerMessageId) => void;
  setMessageTts: (clientMessageId: ClientMessageId, tts: MessageTts) => void;
  appendDelta: (clientMessageId: ClientMessageId, chunk: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  byBuddy: {},
  messages: {},
  setBuddyMessages: (buddyId, list) =>
    set((s) => {
      const messages = { ...s.messages };
      const ids: ClientMessageId[] = [];
      for (const m of list) {
        if (isHiddenHelperSubmitMessage(m)) continue;
        messages[m.clientMessageId] = m;
        ids.push(m.clientMessageId);
      }
      return { messages, byBuddy: { ...s.byBuddy, [buddyId]: ids } };
    }),
  appendMessage: (msg) =>
    set((s) => {
      if (isHiddenHelperSubmitMessage(msg)) return s;
      const list = s.byBuddy[msg.buddyId] ?? [];
      const duplicateClientId = list.find((clientMessageId) => {
        const existing = s.messages[clientMessageId];
        return existing ? isLikelyDuplicateMessage(existing, msg) : false;
      });
      if (duplicateClientId) return s;
      if (list.includes(msg.clientMessageId)) {
        const existing = s.messages[msg.clientMessageId];
        if (existing && sameMessage(existing, msg)) return s;
        return { messages: { ...s.messages, [msg.clientMessageId]: msg } };
      }
      return {
        messages: { ...s.messages, [msg.clientMessageId]: msg },
        byBuddy: { ...s.byBuddy, [msg.buddyId]: [...list, msg.clientMessageId] },
      };
    }),
  setStatus: (clientMessageId, status) =>
    set((s) => {
      const existing = s.messages[clientMessageId];
      if (!existing) return s;
      return {
        messages: { ...s.messages, [clientMessageId]: { ...existing, status } },
      };
    }),
  setServerId: (clientMessageId, serverId) =>
    set((s) => {
      const existing = s.messages[clientMessageId];
      if (!existing) return s;
      return {
        messages: { ...s.messages, [clientMessageId]: { ...existing, id: serverId } },
      };
    }),
  setMessageTts: (clientMessageId, tts) =>
    set((s) => {
      const existing = s.messages[clientMessageId];
      if (!existing) return s;
      return {
        messages: { ...s.messages, [clientMessageId]: { ...existing, tts } },
      };
    }),
  appendDelta: (clientMessageId, chunk) =>
    set((s) => {
      const existing = s.messages[clientMessageId];
      if (!existing) return s;
      return {
        messages: {
          ...s.messages,
          [clientMessageId]: { ...existing, text: existing.text + chunk },
        },
      };
    }),
  reset: () => set({ byBuddy: {}, messages: {} }),
}));
