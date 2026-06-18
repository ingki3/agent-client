import type { Buddy, BuddyId } from '@/domain/entities/Buddy';

import type { Database } from '../database';

interface BuddyRow {
  id: string;
  username: string | null;
  display_name: string;
  icon_url: string | null;
  trace_supported: number;
  last_message_preview: string | null;
  last_message_at: number | null;
  unread_count: number;
  created_at: number;
}

function rowToBuddy(row: BuddyRow): Buddy {
  return {
    id: row.id,
    username: row.username ?? '',
    displayName: row.display_name,
    iconUrl: row.icon_url,
    traceSupported: row.trace_supported === 1,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
    createdAt: row.created_at,
  };
}

export class BuddiesRepository {
  constructor(private readonly db: Database) {}

  upsert(buddy: Buddy): void {
    this.db.run(
      `INSERT INTO buddies
        (id, username, display_name, icon_url, trace_supported,
         last_message_preview, last_message_at, unread_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username=excluded.username,
         display_name=excluded.display_name,
         icon_url=excluded.icon_url,
         trace_supported=excluded.trace_supported,
         last_message_preview=excluded.last_message_preview,
         last_message_at=excluded.last_message_at,
         unread_count=excluded.unread_count`,
      [
        buddy.id,
        buddy.username || null,
        buddy.displayName,
        buddy.iconUrl,
        buddy.traceSupported ? 1 : 0,
        buddy.lastMessagePreview,
        buddy.lastMessageAt,
        buddy.unreadCount,
        buddy.createdAt,
      ],
    );
  }

  remove(id: BuddyId): void {
    this.db.run('DELETE FROM buddies WHERE id = ?', [id]);
  }

  findById(id: BuddyId): Buddy | null {
    const row = this.db.first<BuddyRow>('SELECT * FROM buddies WHERE id = ?', [id]);
    return row ? rowToBuddy(row) : null;
  }

  markRead(id: BuddyId): void {
    this.db.run('UPDATE buddies SET unread_count = 0 WHERE id = ?', [id]);
  }

  listAll(): Buddy[] {
    return this.db
      .all<BuddyRow>('SELECT * FROM buddies ORDER BY last_message_at DESC NULLS LAST, created_at DESC')
      .map(rowToBuddy);
  }
}
