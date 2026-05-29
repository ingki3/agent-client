/**
 * Domain entities (PRD §5.4, TECH_SPEC §2 Domain Layer).
 * Pure TypeScript — no React / Expo / RN imports allowed here.
 */

export type AccentSlot =
  | "accent-buddy-1"
  | "accent-buddy-2"
  | "accent-buddy-3"
  | "accent-buddy-4"
  | "accent-buddy-5"
  | "accent-buddy-6"
  | "accent-buddy-7"
  | "accent-buddy-8";

/** A registered agent (Telegram-compatible bot). */
export type Buddy = {
  id: string;
  displayName: string;
  /** @username from getMe, or a synthetic handle for mock buddies. */
  handle: string;
  /** Telegram bot id (from getMe). null for local mock buddies. */
  botId: number | null;
  /**
   * The chat the app converses in. Learned from the first incoming update for a real
   * bot; null until then. Mock buddies use a synthetic id.
   */
  chatId: number | string | null;
  /** True when this buddy is backed by a real bot token in SecureStore. */
  live: boolean;
  /** Whether the gateway advertised trace-stream support (else fallback: body only). */
  supportsTrace: boolean;
  accent: AccentSlot;
  description: string;
  connected: boolean;
  unread: number;
  lastMessagePreview: string;
  lastMessageAt: string; // ISO
};

export type MessageRole = "user" | "agent" | "system";

export type MessageStatus =
  | "sending"
  | "sent"
  | "streaming"
  | "done"
  | "failed"
  | "queued-offline";

export type TraceSummary = { thinkingSteps: number; toolCalls: number; elapsedMs: number };

export type Message = {
  id: string;
  /** Stable client id for optimistic-update reconciliation (TECH_SPEC §12.3). */
  clientId: string;
  buddyId: string;
  role: MessageRole;
  text: string;
  createdAt: string; // ISO
  status?: MessageStatus;
  traceId?: string;
  traceSummary?: TraceSummary;
};

export type TraceNodeKind = "thinking" | "tool_call" | "tool_result";

export type TraceNode = {
  kind: TraceNodeKind;
  seq: number;
  startedAt?: number;
  latencyMs?: number;
  payload: Record<string, unknown>;
};

export type Trace = {
  id: string;
  messageId: string;
  nodes: TraceNode[];
};

/** Allowed message status transitions (TECH_SPEC §2 "status transitions"). */
const TRANSITIONS: Record<MessageStatus, MessageStatus[]> = {
  sending: ["sent", "failed", "queued-offline"],
  "queued-offline": ["sending", "sent", "failed"],
  sent: ["streaming", "done", "failed"],
  streaming: ["done", "failed"],
  done: [],
  failed: ["sending"],
};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Mask sensitive tool-call argument values for trace rendering (FR-19, Q7). */
const SENSITIVE_KEY = /token|secret|password|api[_-]?key|authorization|cookie|bearer/i;

export function maskArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "••••••••";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = maskArgs(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
