import { create } from 'zustand';

import { buddies as buddyFixtures, type Buddy } from '@/lib/mock/fixtures';

type BuddiesState = {
  buddies: Buddy[];
  addBuddy: (
    input: Pick<Buddy, 'displayName' | 'handle' | 'accent' | 'role' | 'description'>,
  ) => string;
  setUnread: (buddyId: string, unread: number) => void;
};

export const useBuddiesStore = create<BuddiesState>((set) => ({
  buddies: buddyFixtures,
  addBuddy: (input) => {
    const id = `buddy-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    set((s) => ({
      buddies: [
        ...s.buddies,
        {
          id,
          connected: true,
          unread: 0,
          lastMessagePreview: '환영해요! 무엇을 도와드릴까요?',
          lastMessageAt: now,
          ...input,
        },
      ],
    }));
    return id;
  },
  setUnread: (buddyId, unread) =>
    set((s) => ({
      buddies: s.buddies.map((b) => (b.id === buddyId ? { ...b, unread } : b)),
    })),
}));
