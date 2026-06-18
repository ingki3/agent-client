import type { BuddyId } from '@/domain/entities/Buddy';

import type { Database } from '../database';

interface SyncStateRow {
  peer_id: string;
  cursor: number;
  updated_at: number;
}

export class MessageSyncStateRepository {
  constructor(private readonly db: Database) {}

  getCursor(peerId: BuddyId): number {
    const row = this.db.first<Pick<SyncStateRow, 'cursor'>>(
      'SELECT cursor FROM message_sync_state WHERE peer_id = ?',
      [peerId],
    );
    return row?.cursor ?? 0;
  }

  advanceCursor(peerId: BuddyId, cursor: number, updatedAt: number): void {
    const current = this.getCursor(peerId);
    const next = Math.max(current, cursor);
    this.db.run(
      `INSERT INTO message_sync_state (peer_id, cursor, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET
         cursor = MAX(message_sync_state.cursor, excluded.cursor),
         updated_at = excluded.updated_at`,
      [peerId, next, updatedAt],
    );
  }
}
