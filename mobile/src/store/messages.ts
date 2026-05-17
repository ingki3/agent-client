import { create } from "zustand";
import { messagesByBuddy as messageFixtures, type Message } from "@/mock/fixtures";

type MessagesState = {
  byBuddy: Record<string, Message[]>;
  send: (buddyId: string, text: string) => void;
  receive: (buddyId: string, text: string) => void;
};

const cannedAgentReplies = [
  "확인했어요. 잠시만요…",
  "방금 확인했어요. 추가로 필요한 부분이 있으면 알려주세요.",
  "관련 정보를 정리하는 중이에요. 곧 카드로 답변드릴게요.",
];

export const useMessagesStore = create<MessagesState>((set) => ({
  byBuddy: messageFixtures,
  send: (buddyId, text) => {
    if (!text.trim()) return;
    const id = `u-${Date.now()}`;
    const now = new Date().toISOString();
    set((s) => ({
      byBuddy: {
        ...s.byBuddy,
        [buddyId]: [
          ...(s.byBuddy[buddyId] ?? []),
          {
            id,
            buddyId,
            author: "user",
            text: text.trim(),
            createdAt: now,
            status: "sent",
          },
        ],
      },
    }));

    // Fake agent echo so the usability test feels responsive.
    setTimeout(() => {
      set((s) => {
        const reply = cannedAgentReplies[Math.floor(Math.random() * cannedAgentReplies.length)];
        return {
          byBuddy: {
            ...s.byBuddy,
            [buddyId]: [
              ...(s.byBuddy[buddyId] ?? []),
              {
                id: `a-${Date.now()}`,
                buddyId,
                author: "agent",
                text: reply,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        };
      });
    }, 700);
  },
  receive: (buddyId, text) =>
    set((s) => ({
      byBuddy: {
        ...s.byBuddy,
        [buddyId]: [
          ...(s.byBuddy[buddyId] ?? []),
          {
            id: `a-${Date.now()}`,
            buddyId,
            author: "agent",
            text,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })),
}));
