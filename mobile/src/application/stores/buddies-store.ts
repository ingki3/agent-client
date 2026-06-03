import { create } from 'zustand';

import type { Buddy, BuddyId } from '@/domain/entities/Buddy';
import type { BotIdentity } from '@/domain/value-objects/BotIdentity';

interface BuddiesState {
  buddies: Record<BuddyId, Buddy>;
  order: BuddyId[];
  /** getMe 결과 캐시: 봇 토큰별로 1회 호출 후 저장. */
  getMeCache: Record<string, BotIdentity>;
  setAll: (buddies: Buddy[]) => void;
  upsert: (buddy: Buddy) => void;
  remove: (id: BuddyId) => void;
  cacheGetMe: (token: string, identity: BotIdentity) => void;
  getCachedMe: (token: string) => BotIdentity | undefined;
  reset: () => void;
}

function indexBuddies(list: Buddy[]): {
  buddies: Record<BuddyId, Buddy>;
  order: BuddyId[];
} {
  const buddies: Record<BuddyId, Buddy> = {};
  const order: BuddyId[] = [];
  for (const b of list) {
    buddies[b.id] = b;
    order.push(b.id);
  }
  return { buddies, order };
}

export const useBuddiesStore = create<BuddiesState>((set, get) => ({
  buddies: {},
  order: [],
  getMeCache: {},
  setAll: (list) => set(() => indexBuddies(list)),
  upsert: (buddy) =>
    set((s) => {
      const exists = buddy.id in s.buddies;
      const order = exists ? s.order : [...s.order, buddy.id];
      return { buddies: { ...s.buddies, [buddy.id]: buddy }, order };
    }),
  remove: (id) =>
    set((s) => {
      if (!(id in s.buddies)) return s;
      const rest = { ...s.buddies };
      delete rest[id];
      return { buddies: rest, order: s.order.filter((b) => b !== id) };
    }),
  cacheGetMe: (token, identity) =>
    set((s) => ({ getMeCache: { ...s.getMeCache, [token]: identity } })),
  getCachedMe: (token) => get().getMeCache[token],
  reset: () => set({ buddies: {}, order: [], getMeCache: {} }),
}));
