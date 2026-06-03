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
  /** Telegram peer id (the bot's user id, == chatId for a private chat). null for mock. */
  botId: number | null;
  /** Peer @username used to resolve/send via the relay (MTProto). undefined for mock. */
  username?: string;
  /**
   * The chat the app converses in. For a live peer this equals the peer id. Mock buddies
   * use a synthetic id.
   */
  chatId: number | string | null;
  /** True when this buddy is a real resolved peer the relay talks to (vs a local mock). */
  live: boolean;
  /** Whether the gateway advertised trace-stream support (else fallback: body only). */
  supportsTrace: boolean;
  accent: AccentSlot;
  description: string;
  connected: boolean;
  unread: number;
  lastMessagePreview: string;
  lastMessageAt: string; // ISO
  /** Id of the last message the user had seen — restored as the scroll position on re-open. */
  lastReadId?: string;
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

export type TtsMode = "brief" | "explain" | "action_items";

export type MessageTts = {
  status: "idle" | "generating" | "ready" | "playing" | "failed";
  mode?: TtsMode;
  audioUrl?: string;
  script?: string;
  error?: string;
};

/** Link (webpage) preview attached to a message — title/description/image for a URL. */
export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Fully-qualified image URL (relayBase already prepended) or undefined. */
  image?: string;
};

export type InlineKeyboardButton = {
  id: string;
  label: string;
  type: "callback" | "url" | "web_app" | "login_url" | "switch_inline" | "copy" | "unsupported";
  url?: string;
  copyText?: string;
  style?: "primary" | "success" | "danger" | "default";
  disabled?: boolean;
};

export type InlineKeyboard = {
  rows: InlineKeyboardButton[][];
};

export type AttachmentKind = "image" | "video" | "voice" | "audio" | "document";

/** A file attached to a message. `uri` is the local file (for the sender's optimistic view). */
export type Attachment = {
  kind: AttachmentKind;
  uri: string;
  name: string;
  mime: string;
  size?: number;
  durationMs?: number;
};

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
  preview?: LinkPreview;
  /** One or more attachments shown in a single bubble (a media album / file group). */
  attachments?: Attachment[];
  /** Quoted message this one replies to (snippet shown above the bubble; links via Telegram reply). */
  replyTo?: { messageId?: number; text: string };
  taskId?: string;
  artifactIds?: string[];
  formId?: string;
  helperItems?: HelperItem[];
  tts?: MessageTts;
  inlineKeyboard?: InlineKeyboard;
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

export type TaskStatus =
  | "requested"
  | "running"
  | "needs_input"
  | "review_needed"
  | "completed"
  | "blocked"
  | "archived";

export type AgentTask = {
  id: string;
  buddyId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  sourceMessageId?: string;
  artifactIds: string[];
};

export type ArtifactKind = "markdown" | "code" | "table" | "json" | "file" | "checklist";

export type AgentArtifact = {
  id: string;
  buddyId: string;
  taskId?: string;
  sourceMessageId?: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  language?: string;
  createdAt: string;
};

export type FormFieldKind = "single_select" | "multi_select" | "text" | "number" | "date" | "file" | "confirm";

export type FormFieldOption = {
  label: string;
  value: string;
};

export type FormField = {
  id: string;
  kind: FormFieldKind;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
};

export type FormValue = string | number | boolean | string[] | null;

export type FormCardStatus = "pending" | "submitted" | "cancelled";

export type AgentForm = {
  id: string;
  buddyId: string;
  taskId?: string;
  sourceMessageId?: string;
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel: string;
  cancelLabel?: string;
  status: FormCardStatus;
  values?: Record<string, FormValue>;
  createdAt: string;
  submittedAt?: string;
};

export type AgentPayload =
  | { type: "task_update"; task: Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "status"> }
  | { type: "artifact"; artifact: Omit<AgentArtifact, "buddyId" | "sourceMessageId" | "createdAt"> & Partial<Pick<AgentArtifact, "createdAt">> }
  | { type: "form"; form: Omit<AgentForm, "buddyId" | "sourceMessageId" | "createdAt" | "status"> & Partial<Pick<AgentForm, "createdAt" | "status">> };

export type HelperOption = { label: string; value: string };
export type HelperField = {
  id: string;
  kind: "text" | "textarea" | "number" | "date" | "single_select" | "multi_select" | "confirm";
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: HelperOption[];
};
export type HelperItem =
  | { type: "quick_replies"; id: string; title?: string; options: HelperOption[] }
  | { type: "single_select"; id: string; title: string; description?: string; options: HelperOption[]; submitLabel: string }
  | { type: "multi_select"; id: string; title: string; description?: string; options: HelperOption[]; submitLabel: string }
  | { type: "input_form"; id: string; title: string; description?: string; fields: HelperField[]; submitLabel: string; cancelLabel?: string }
  | { type: "confirm_action"; id: string; title: string; description?: string; summary?: string[]; confirmLabel: string; reviseLabel?: string; cancelLabel?: string }
  | { type: "artifact_suggestion"; id: string; title: string; artifact: { kind: ArtifactKind; title: string; content: string; language?: string } };

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
