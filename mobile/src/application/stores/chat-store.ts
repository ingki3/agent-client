import { create } from 'zustand';

import type { BuddyId } from '@/domain/entities/Buddy';
import type {
  ClientMessageId,
  Message,
  MessageStatus,
  ServerMessageId,
} from '@/domain/entities/Message';

interface ChatState {
  /** buddyId -> ordered clientMessageId 배열. 화면 키는 clientMessageId (TECH §12.3). */
  byBuddy: Record<BuddyId, ClientMessageId[]>;
  /** clientMessageId -> Message. SQLite 영속 데이터의 메모리 미러. */
  messages: Record<ClientMessageId, Message>;
  setBuddyMessages: (buddyId: BuddyId, messages: Message[]) => void;
  appendMessage: (msg: Message) => void;
  setStatus: (clientMessageId: ClientMessageId, status: MessageStatus) => void;
  setServerId: (clientMessageId: ClientMessageId, serverId: ServerMessageId) => void;
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
        messages[m.clientMessageId] = m;
        ids.push(m.clientMessageId);
      }
      return { messages, byBuddy: { ...s.byBuddy, [buddyId]: ids } };
    }),
  appendMessage: (msg) =>
    set((s) => {
      const list = s.byBuddy[msg.buddyId] ?? [];
      if (list.includes(msg.clientMessageId)) {
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
