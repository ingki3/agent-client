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
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    clientMessageId: row.client_message_id,
    buddyId: row.buddy_id,
    role: row.role as Message['role'],
    text: row.text,
    status: row.status as MessageStatus,
    createdAt: row.created_at,
    traceId: row.trace_id,
  };
}

export class MessagesRepository {
  constructor(private readonly db: Database) {}

  insert(msg: Message): void {
    this.db.run(
      `INSERT INTO messages
        (id, client_message_id, buddy_id, role, text, status, created_at, trace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id ?? msg.clientMessageId,
        msg.clientMessageId,
        msg.buddyId,
        msg.role,
        msg.text,
        msg.status,
        msg.createdAt,
        msg.traceId,
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

  listByBuddy(buddyId: BuddyId, limit = 200): Message[] {
    return this.db
      .all<MessageRow>(
        'SELECT * FROM messages WHERE buddy_id = ? ORDER BY created_at ASC LIMIT ?',
        [buddyId, limit],
      )
      .map(rowToMessage);
  }
}
