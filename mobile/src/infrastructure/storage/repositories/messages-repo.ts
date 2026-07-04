import type { BuddyId } from '@/domain/entities/Buddy';
import type {
  ClientMessageId,
  Message,
  MessageStatus,
  ServerMessageId,
} from '@/domain/entities/Message';
import { deepStableEqual } from '@/domain/objects/stableComparison';

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

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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

  /**
   * Adopt a server identity onto a locally-created row and mark it sent.
   *
   * `messages.id` is the PRIMARY KEY, and the relay echo of our own send can be
   * inserted (id = clientMessageId = serverId) before /send resolves — a plain
   * updateServerId then hits a PK conflict and fails the whole markSent
   * transaction. This merges the echo row's rich fields into the local row,
   * deletes the echo row, and only then assigns the server id. Idempotent when
   * the local row already carries the server id.
   */
  adoptServerId(clientMessageId: ClientMessageId, serverId: ServerMessageId): void {
    const echo = this.findByServerId(serverId);
    if (echo && echo.clientMessageId !== clientMessageId) {
      const local = this.findByClientMessageId(clientMessageId);
      if (!local) return;
      this.db.run(
        `UPDATE messages
         SET preview_json = COALESCE(preview_json, ?),
             helper_items_json = COALESCE(helper_items_json, ?),
             inline_keyboard_json = COALESCE(inline_keyboard_json, ?),
             attachments_json = COALESCE(attachments_json, ?)
         WHERE client_message_id = ?`,
        [
          stringifyJson(echo.preview),
          stringifyJson(echo.helperItems),
          stringifyJson(echo.inlineKeyboard),
          stringifyJson(echo.attachments),
          clientMessageId,
        ],
      );
      this.db.run('DELETE FROM messages WHERE client_message_id = ?', [echo.clientMessageId]);
    }
    this.db.run(
      "UPDATE messages SET id = ?, status = 'sent' WHERE client_message_id = ?",
      [serverId, clientMessageId],
    );
  }

  /**
   * Text fallback for echo adoption when the relay does not send a clientTag:
   * the OLDEST pending (sending/queued) user-role row with identical
   * whitespace-compacted text created within `windowMs` of `now` — FIFO so a
   * double-send of the same text adopts echoes in order.
   */
  findPendingUserMessageByText(
    buddyId: BuddyId,
    text: string,
    windowMs: number,
    now: number,
  ): Message | null {
    const compacted = compactText(text);
    if (!compacted) return null;
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages
       WHERE buddy_id = ? AND role = 'user' AND status IN ('sending', 'queued')
         AND created_at >= ?
       ORDER BY created_at ASC`,
      [buddyId, now - windowMs],
    );
    const match = rows.find((row) => compactText(row.text) === compacted);
    return match ? rowToMessage(match) : null;
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
    let changed = false;
    if (fields.text !== undefined && fields.text !== existing.text) {
      next.text = fields.text;
      changed = true;
    }
    if (fields.preview && !deepStableEqual(fields.preview, existing.preview)) {
      next.preview = fields.preview;
      changed = true;
    }
    if (fields.helperItems && !deepStableEqual(fields.helperItems, existing.helperItems)) {
      next.helperItems = fields.helperItems;
      changed = true;
    }
    if (fields.inlineKeyboard !== undefined && !deepStableEqual(fields.inlineKeyboard, existing.inlineKeyboard)) {
      next.inlineKeyboard = fields.inlineKeyboard;
      changed = true;
    }
    if (fields.attachments && !deepStableEqual(fields.attachments, existing.attachments)) {
      next.attachments = fields.attachments;
      changed = true;
    }
    if (!changed) return null;
    this.db.run(
      `UPDATE messages
       SET text = ?,
           preview_json = ?,
           helper_items_json = ?,
           inline_keyboard_json = ?,
           attachments_json = ?
       WHERE id = ?`,
      [
        next.text,
        stringifyJson(next.preview),
        stringifyJson(next.helperItems),
        stringifyJson(next.inlineKeyboard),
        stringifyJson(next.attachments),
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
