import { create } from 'zustand';

import type { Trace, TraceNode } from '@/domain/entities/Trace';

interface TraceState {
  /** messageId -> trace 노드 시퀀스. */
  byMessage: Record<string, TraceNode[]>;
  setTrace: (trace: Trace) => void;
  appendNode: (messageId: string, node: TraceNode) => void;
  reset: () => void;
}

export const useTraceStore = create<TraceState>((set) => ({
  byMessage: {},
  setTrace: (trace) =>
    set((s) => ({ byMessage: { ...s.byMessage, [trace.messageId]: trace.nodes } })),
  appendNode: (messageId, node) =>
    set((s) => {
      const existing = s.byMessage[messageId] ?? [];
      return { byMessage: { ...s.byMessage, [messageId]: [...existing, node] } };
    }),
  reset: () => set({ byMessage: {} }),
}));
