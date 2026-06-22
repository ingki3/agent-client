import type { BuddyId } from './Buddy';

export type MessageRole = 'user' | 'agent' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'queued';

export type ClientMessageId = string;

export type ServerMessageId = string;

export type TtsMode = 'brief' | 'explain' | 'action_items';

export type MessageTts = {
  status: 'idle' | 'generating' | 'ready' | 'playing' | 'failed';
  mode?: TtsMode;
  audioUrl?: string;
  script?: string;
  error?: string;
};

export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
};

export type InlineKeyboardButton = {
  id: string;
  label: string;
  type: 'callback' | 'url' | 'web_app' | 'login_url' | 'switch_inline' | 'copy' | 'unsupported';
  url?: string;
  copyText?: string;
  style?: 'primary' | 'success' | 'danger' | 'default';
  disabled?: boolean;
};

export type InlineKeyboard = {
  rows: InlineKeyboardButton[][];
};

export type HelperOption = { label: string; value: string };

export type FormValue = string | number | boolean | string[] | null;

export type HelperField = {
  id: string;
  kind: 'text' | 'textarea' | 'number' | 'date' | 'single_select' | 'multi_select' | 'confirm';
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: HelperOption[];
};

export type HelperItem =
  | { type: 'quick_replies'; id: string; title?: string; options: HelperOption[] }
  | { type: 'single_select' | 'multi_select'; id: string; title: string; description?: string; options: HelperOption[]; submitLabel: string }
  | { type: 'input_form'; id: string; title: string; description?: string; fields: HelperField[]; submitLabel: string; cancelLabel?: string }
  | { type: 'confirm_action'; id: string; title: string; description?: string; summary?: string[]; confirmLabel: string; cancelLabel?: string; reviseLabel?: string }
  | { type: 'artifact_suggestion'; id: string; title: string; artifact: { kind: string; title: string; content: string; language?: string } }
  | { type: string; id: string; title?: string; [key: string]: unknown };

export type AttachmentKind = 'image' | 'video' | 'voice' | 'audio' | 'document';

export type Attachment = {
  kind: string;
  uri: string;
  name: string;
  mime: string;
  size?: number;
};

export interface Message {
  id: ServerMessageId | null;
  clientMessageId: ClientMessageId;
  buddyId: BuddyId;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  createdAt: number;
  traceId: string | null;
  preview?: LinkPreview;
  helperItems?: HelperItem[];
  inlineKeyboard?: InlineKeyboard | null;
  attachments?: Attachment[];
  tts?: MessageTts;
}
