/**
 * Trace store — TECH §2.4. Per-message ordered trace nodes (thinking,
 * tool_call, tool_result) plus expand/collapse state.
 *
 * Foundation (BIZ-268) ships the empty slice; node-append + reducers land
 * with M1 sub 6 (BIZ-275) alongside `TraceStreamClient` (TECH §3.2).
 */
import { create } from 'zustand';

export type TraceNodeKind = 'thinking' | 'tool_call' | 'tool_result';

export type TraceNode = {
  id: string;
  kind: TraceNodeKind;
  label: string;
  payload?: unknown;
  createdAt: string;
};

type TraceState = {
  byMessage: Record<string, TraceNode[]>;
  expanded: Record<string, boolean>;
};

export const useTraceStore = create<TraceState>(() => ({
  byMessage: {},
  expanded: {},
}));
