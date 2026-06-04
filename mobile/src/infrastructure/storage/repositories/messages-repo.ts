import type { BuddyId } from '@/domain/entities/Buddy';
import type {
  ClientMessageId,
  Message,
  MessageStatus,
  ServerMessageId,
} from '@/domain/entities/Message';

import type { Database } from '../database';

interface MessageRow {
  id: string | null;
  client_message_id: string;
  buddy_id: string;
  role: string;
  text: string;
  status: string;
  created_at: number;
  trace_id: string | null;
  preview_json: string | null;
  helper_items_json: string | null;
  inline_keyboard_json: string | null;
  attachments_json: string | null;
}

function rowToMessage(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    clientMessageId: row.client_message_id,
    buddyId: row.buddy_id,
    role: row.role as Message['role'],
    text: row.text,
    status: row.status as MessageStatus,
    createdAt: row.created_at,
    traceId: row.trace_id,
  };
  const preview = parseJson<Message['preview']>(row.preview_json);
  const helperItems = parseJson<Message['helperItems']>(row.helper_items_json);
  const inlineKeyboard = parseJson<Message['inlineKeyboard']>(row.inline_keyboard_json);
  const attachments = parseJson<Message['attachments']>(row.attachments_json);
  if (preview) message.preview = preview;
  if (helperItems) message.helperItems = helperItems;
  if (inlineKeyboard) message.inlineKeyboard = inlineKeyboard;
  if (attachments) message.attachments = attachments;
  return message;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function stringifyJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

export class MessagesRepository {
  constructor(private readonly db: Database) {}

  insert(msg: Message): void {
    this.db.run(
      `INSERT INTO messages
        (id, client_message_id, buddy_id, role, text, status, created_at, trace_id,
         preview_json, helper_items_json, inline_keyboard_json, attachments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id ?? msg.clientMessageId,
        msg.clientMessageId,
        msg.buddyId,
        msg.role,
        msg.text,
        msg.status,
        msg.createdAt,
        msg.traceId,
        stringifyJson(msg.preview),
        stringifyJson(msg.helperItems),
        stringifyJson(msg.inlineKeyboard),
        stringifyJson(msg.attachments),
      ],
    );
  }

  updateServerId(clientMessageId: ClientMessageId, serverId: ServerMessageId): void {
    this.db.run('UPDATE messages SET id = ? WHERE client_message_id = ?', [
      serverId,
      clientMessageId,
    ]);
  }

  updateStatus(clientMessageId: ClientMessageId, status: MessageStatus): void {
    this.db.run('UPDATE messages SET status = ? WHERE client_message_id = ?', [
      status,
      clientMessageId,
    ]);
  }

  findByClientMessageId(clientMessageId: ClientMessageId): Message | null {
    const row = this.db.first<MessageRow>(
      'SELECT * FROM messages WHERE client_message_id = ?',
      [clientMessageId],
    );
    return row ? rowToMessage(row) : null;
  }

  findByServerId(serverId: ServerMessageId): Message | null {
    const row = this.db.first<MessageRow>('SELECT * FROM messages WHERE id = ?', [serverId]);
    return row ? rowToMessage(row) : null;
  }

  insertRemoteIfAbsent(msg: Message): Message | null {
    const serverId = msg.id;
    if (serverId && this.findByServerId(serverId)) return null;
    if (this.findByClientMessageId(msg.clientMessageId)) return null;
    this.insert(msg);
    return msg;
  }

  mergeRemoteFields(serverId: ServerMessageId, fields: Partial<Pick<Message, 'preview' | 'helperItems' | 'inlineKeyboard' | 'attachments' | 'text'>>): Message | null {
    const existing = this.findByServerId(serverId);
    if (!existing) return null;
    const next: Message = { ...existing };
    if (fields.text && fields.text !== existing.text) next.text = fields.text;
    if (fields.preview) next.preview = fields.preview;
    if (fields.helperItems) next.helperItems = fields.helperItems;
    if (fields.inlineKeyboard !== undefined) next.inlineKeyboard = fields.inlineKeyboard;
    if (fields.attachments) next.attachments = fields.attachments;
    this.db.run(
      `UPDATE messages
       SET text = ?,
           preview_json = COALESCE(?, preview_json),
           helper_items_json = COALESCE(?, helper_items_json),
           inline_keyboard_json = ?,
           attachments_json = COALESCE(?, attachments_json)
       WHERE id = ?`,
      [
        next.text,
        stringifyJson(fields.preview),
        stringifyJson(fields.helperItems),
        stringifyJson(fields.inlineKeyboard),
        stringifyJson(fields.attachments),
        serverId,
      ],
    );
    return next;
  }

  listByBuddy(buddyId: BuddyId, limit = 200): Message[] {
    return this.db
      .all<MessageRow>(
        'SELECT * FROM messages WHERE buddy_id = ? ORDER BY created_at ASC LIMIT ?',
        [buddyId, limit],
      )
      .map(rowToMessage);
  }
}
