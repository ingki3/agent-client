import type { BuddyId } from '@/domain/entities/Buddy';
import type { ClientMessageId } from '@/domain/entities/Message';

import type { Database } from '../database';

export interface OutboxEntry {
  messageId: ClientMessageId;
  buddyId: BuddyId;
  text: string;
  retryCount: number;
  lastError: string | null;
  enqueuedAt: number;
}

interface OutboxRow {
  message_id: string;
  buddy_id: string;
  text: string;
  retry_count: number;
  last_error: string | null;
  enqueued_at: number;
}

function rowToEntry(row: OutboxRow): OutboxEntry {
  return {
    messageId: row.message_id,
    buddyId: row.buddy_id,
    text: row.text,
    retryCount: row.retry_count,
    lastError: row.last_error,
    enqueuedAt: row.enqueued_at,
  };
}

export class OutboxRepository {
  constructor(private readonly db: Database) {}

  enqueue(entry: OutboxEntry): void {
    this.db.run(
      `INSERT INTO outbox (message_id, buddy_id, text, retry_count, last_error, enqueued_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         retry_count=excluded.retry_count,
         last_error=excluded.last_error`,
      [
        entry.messageId,
        entry.buddyId,
        entry.text,
        entry.retryCount,
        entry.lastError,
        entry.enqueuedAt,
      ],
    );
  }

  remove(messageId: ClientMessageId): void {
    this.db.run('DELETE FROM outbox WHERE message_id = ?', [messageId]);
  }

  listOldestFirst(): OutboxEntry[] {
    return this.db
      .all<OutboxRow>('SELECT * FROM outbox ORDER BY enqueued_at ASC')
      .map(rowToEntry);
  }

  count(): number {
    const row = this.db.first<{ c: number }>('SELECT COUNT(*) AS c FROM outbox');
    return row?.c ?? 0;
  }
}
