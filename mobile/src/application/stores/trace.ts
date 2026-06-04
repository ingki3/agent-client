/**
 * Trace store — TECH §2.4. Per-message ordered trace nodes (thinking,
 * tool_call, tool_result) plus expand/collapse state.
 *
 * Foundation (BIZ-268) ships the empty slice; node-append + reducers land
 * with M1 sub 6 (BIZ-275) alongside `TraceStreamClient` (TECH §3.2).
 */
import { create } from 'zustand';
import type { TraceNode } from '@/domain/entities';

type TraceState = {
  byMessage: Record<string, TraceNode[]>;
  expanded: Record<string, boolean>;
  toggle: (messageId: string) => void;
  clear: () => void;
};

export const useTraceStore = create<TraceState>((set) => ({
  byMessage: {},
  expanded: {},
  toggle: (messageId) =>
    set((s) => ({ expanded: { ...s.expanded, [messageId]: !(s.expanded[messageId] ?? false) } })),
  clear: () => set({ byMessage: {}, expanded: {} }),
}));
