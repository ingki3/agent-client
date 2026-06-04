/** Telegram update shapes — mirror the app's telegramBotApi.ts so /pull is drop-in. */
export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Relative relay path that proxies the Telegram webpage photo; app prepends relayBase. */
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

export type TgMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; first_name: string; username?: string };
  /** True when the user sent this message (from any client) — app renders it as "user". */
  outgoing?: boolean;
  /** Telegram webpage preview (Open-Graph-like) for a link in the message. */
  preview?: LinkPreview;
  /** Attached media (photo/document/video/voice); `url` is a relay path to fetch the bytes. */
  media?: { kind: string; name: string; mime: string; size?: number; url: string };
  /** App-specific structured collaboration payload (Task / Artifact / Form). */
  agent_payload?: AgentPayload;
  agent_payloads?: AgentPayload[];
  helper_items?: HelperItem[];
  inline_keyboard?: InlineKeyboard | null;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
};

// botToken is optional: MTProto peers (user-account path) register a subscription with no
// token (the relay's GramJS client receives for them — no per-bot getUpdates loop).
export type RegisterBot = { buddyId: string; botToken?: string; botId: number };

export type RegisterBody = {
  deviceId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  gateway: string;
  bots: RegisterBot[];
};

// ─── MTProto (user-account) request bodies ───────────────────────────────────
export type AuthStartBody = { deviceId: string; phone: string };
export type AuthCodeBody = { deviceId: string; code: string };
export type Auth2faBody = { deviceId: string; password: string };
export type PeerResolveBody = { deviceId: string; username: string };
export type PeerRemoveBody = { deviceId: string; peerId: number };
export type MessageSyncBody = { deviceId: string; peerId: number; sinceUpdateId?: number; limit?: number };
export type SendBody = { deviceId: string; peerId: number; text: string; clientTag?: string; replyTo?: number };

export type AgentPayload =
  | { type: "task_update"; task: Record<string, unknown> }
  | { type: "artifact"; artifact: Record<string, unknown> }
  | { type: "form"; form: Record<string, unknown> };

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
  | { type: "artifact_suggestion"; id: string; title: string; artifact: { kind: string; title: string; content: string; language?: string } };

export type HelperEnvelope = { version: "1"; items: HelperItem[] };

export type FormSubmitBody = {
  deviceId: string;
  peerId: number;
  formId: string;
  taskId?: string;
  status: "submitted" | "cancelled";
  values: Record<string, unknown>;
};

export type HelperSubmitBody = {
  deviceId: string;
  peerId: number;
  helperItemId: string;
  helperType: string;
  action: "submit" | "cancel" | "revise" | "quick_reply" | "save_artifact";
  label?: string;
  value?: string;
  values?: Record<string, unknown>;
  source?: {
    messageId?: number;
    text?: string;
    excerpt?: string;
    urls?: string[];
    handles?: string[];
    preview?: { url?: string; title?: string; description?: string; siteName?: string };
    attachments?: Array<{ kind?: string; name?: string; mime?: string; size?: number }>;
    recentMessages?: Array<{
      messageId?: number;
      role?: string;
      text?: string;
      excerpt?: string;
      urls?: string[];
      handles?: string[];
      preview?: { url?: string; title?: string; description?: string; siteName?: string };
      attachments?: Array<{ kind?: string; name?: string; mime?: string; size?: number }>;
    }>;
  };
};

export type TtsMode = "brief" | "explain" | "action_items";

export type TtsBody = {
  deviceId?: string;
  messageId?: string;
  text?: string;
  mode?: TtsMode;
  voice?: string;
};

export type InlineKeyboardCallbackBody = {
  deviceId?: string;
  peerId?: number;
  messageId?: number;
  buttonId?: string;
};
