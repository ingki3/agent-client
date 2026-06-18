import type { HelperItem, InlineKeyboard, LinkPreview } from '@/domain/entities/Message';

// Telegram-compatible Bot API wire types (TECH_SPEC §12.1, PRD §5.3).
// Only the fields MVP actually consumes are typed; unknown fields are preserved by passing through.

export interface TgBotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  text?: string;
  from?: TgBotUser;
  outgoing?: boolean;
  preview?: LinkPreview;
  media?: { kind: string; name: string; mime: string; size?: number; url: string };
  helper_items?: HelperItem[];
  inline_keyboard?: InlineKeyboard | null;
  edit_date?: number;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

export type TgChatAction =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'choose_sticker';

export interface TgResultEnvelopeOk<T> {
  ok: true;
  result: T;
}

export interface TgResultEnvelopeError {
  ok: false;
  error_code: number;
  description: string;
}

export type TgResultEnvelope<T> = TgResultEnvelopeOk<T> | TgResultEnvelopeError;

export interface SendMessageParams {
  chat_id: string;
  text: string;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: unknown;
}

export interface EditMessageTextParams {
  chat_id: string;
  message_id: number;
  text: string;
}

export interface GetUpdatesParams {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export interface SendChatActionParams {
  chat_id: string;
  action: TgChatAction;
}
