export type TraceNodeKind = 'thinking' | 'tool_call' | 'tool_result';

export interface ThinkingNode {
  kind: 'thinking';
  seq: number;
  startedAt: number;
  step: string;
  summary: string;
  content?: string;
}

export interface ToolCallNode {
  kind: 'tool_call';
  seq: number;
  startedAt: number;
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResultNode {
  kind: 'tool_result';
  seq: number;
  startedAt: number;
  id: string;
  status: 'ok' | 'error';
  resultPreview: string;
  latencyMs?: number;
}

export type TraceNode = ThinkingNode | ToolCallNode | ToolResultNode;

export interface Trace {
  id: string;
  messageId: string;
  nodes: TraceNode[];
  updatedAt: number;
}
