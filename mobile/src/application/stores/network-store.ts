import { create } from 'zustand';

interface NetworkState {
  isOnline: boolean;
  /** SQLite outbox 의 큐잉 카운트. infrastructure layer 가 갱신. */
  pendingOutboxCount: number;
  /** 마지막 단절/복귀 이벤트 ISO timestamp (ms). 디버그용. */
  lastTransitionAt: number | null;
  setOnline: (isOnline: boolean) => void;
  setPendingOutboxCount: (count: number) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  pendingOutboxCount: 0,
  lastTransitionAt: null,
  setOnline: (isOnline) =>
    set((s) => {
      if (s.isOnline === isOnline) return s;
      return { isOnline, lastTransitionAt: Date.now() };
    }),
  setPendingOutboxCount: (count) => set({ pendingOutboxCount: count }),
}));
