/**
 * Trace store (TECH_SPEC §2.4) — thinking / tool_call / tool_result node sequences per
 * message, plus expand/collapse UI state (UC-05, I-01). Nodes accumulate live during
 * streaming and are summarized on completion.
 */
import { create } from "zustand";
import type { Trace, TraceNode, TraceSummary } from "@/domain/entities";

type TraceState = {
  byMessage: Record<string, Trace>;
  expanded: Record<string, boolean>;

  appendNode: (messageId: string, node: Omit<TraceNode, "seq">) => void;
  setTrace: (messageId: string, trace: Trace) => void;
  toggle: (messageId: string) => void;
  summarize: (messageId: string) => TraceSummary | undefined;
  clear: () => void;
};

export const useTraceStore = create<TraceState>((set, get) => ({
  byMessage: {},
  expanded: {},

  appendNode: (messageId, node) =>
    set((s) => {
      const existing = s.byMessage[messageId] ?? { id: `trace-${messageId}`, messageId, nodes: [] };
      const nodes = [...existing.nodes, { ...node, seq: existing.nodes.length }];
      return { byMessage: { ...s.byMessage, [messageId]: { ...existing, nodes } } };
    }),

  setTrace: (messageId, trace) =>
    set((s) => ({ byMessage: { ...s.byMessage, [messageId]: trace } })),

  toggle: (messageId) =>
    set((s) => ({ expanded: { ...s.expanded, [messageId]: !s.expanded[messageId] } })),

  summarize: (messageId) => {
    const trace = get().byMessage[messageId];
    if (!trace || trace.nodes.length === 0) return undefined;
    let thinkingSteps = 0;
    let toolCalls = 0;
    let elapsedMs = 0;
    for (const n of trace.nodes) {
      if (n.kind === "thinking") thinkingSteps += 1;
      if (n.kind === "tool_call") toolCalls += 1;
      if (n.latencyMs) elapsedMs += n.latencyMs;
    }
    return { thinkingSteps, toolCalls, elapsedMs };
  },

  clear: () => set({ byMessage: {}, expanded: {} }),
}));
