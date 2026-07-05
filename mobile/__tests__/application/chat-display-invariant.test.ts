/**
 * Chat DISPLAY INVARIANT — a symptom-level guard for "메시지가 제대로 안 보임".
 *
 * The chat-display bug has recurred from independent causes (oldest-200 window,
 * cursor drift stranding messages, same-second mis-ordering). Unit tests with a
 * handful of rows never hit the real thresholds. This test asserts the RESULT
 * regardless of cause, at realistic scale:
 *
 *   The displayed conversation == the server's most-recent-N messages,
 *   in chronological order (createdAt, then numeric server id), deduped.
 *
 * A regression in any of the interacting mechanisms (listByBuddy recency,
 * ordering tiebreak, cursor/backfill recovery) fails this one test.
 */
import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { MessageSyncStateRepository } from '@/infrastructure/storage/repositories/message-sync-state-repo';
import { listMessages, persistRemoteMessage } from '@/application/usecases/chat';
import type { RelayMessageSnapshot } from '@/application/usecases/chat/types';
import type { Message } from '@/domain/entities/Message';

const BUDDY = '1001';
const PEER = 1001;
const DISPLAY_LIMIT = 200;

function open() {
  const db: Database = createBetterSqlite3Database();
  applyMigrations(db);
  new BuddiesRepository(db).upsert({
    id: BUDDY, username: 'u', displayName: 'U', iconUrl: null, traceSupported: false,
    lastMessagePreview: null, lastMessageAt: null, unreadCount: 0, createdAt: 1,
  });
  const deps = {
    db,
    messagesRepo: new MessagesRepository(db),
    messageSyncStateRepo: new MessageSyncStateRepository(db),
  };
  return { db, deps };
}

function snap(messageId: number, role: 'user' | 'agent', dateSec: number, cursor: number): RelayMessageSnapshot {
  return { id: String(messageId), peerId: PEER, messageId, role, text: `m${messageId}`, status: 'complete', date: dateSec, updatedAt: cursor, cursor };
}

/** The invariant: chronological (createdAt, then numeric id), no dupes, ≤ limit. */
function assertDisplayInvariant(displayed: Message[]) {
  expect(displayed.length).toBeLessThanOrEqual(DISPLAY_LIMIT);
  const ids = displayed.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
  for (let i = 1; i < displayed.length; i += 1) {
    const a = displayed[i - 1]!;
    const b = displayed[i]!;
    const inOrder = a.createdAt < b.createdAt || (a.createdAt === b.createdAt && Number(a.id) <= Number(b.id));
    expect(inOrder).toBe(true);
  }
}

describe('chat display invariant', () => {
  it('shows the most-recent 200 in chronological order — >200 messages, same-second ties', () => {
    const { deps } = open();
    // 248 one-per-second messages, then a same-second user→agent pair (real
    // Telegram: the question gets a lower message_id than the instant reply).
    for (let i = 1; i <= 248; i += 1) persistRemoteMessage(deps, snap(i, i % 2 === 0 ? 'user' : 'agent', 1000 + i, i));
    persistRemoteMessage(deps, snap(249, 'user', 1249, 249));
    persistRemoteMessage(deps, snap(250, 'agent', 1249, 250));

    const displayed = listMessages(deps, { buddyId: BUDDY });
    assertDisplayInvariant(displayed);
    // Recent 200 = ids 51..250 (the 50 oldest dropped), not the oldest 200.
    expect(displayed[0]!.id).toBe('51');
    expect(displayed[displayed.length - 1]!.id).toBe('250');
    // Same-second pair: user (249) before agent (250) — reply never above question.
    expect(displayed.slice(-2).map((m) => m.id)).toEqual(['249', '250']);
    deps.db.close();
  });

  it('recovers messages stranded by cursor drift when the recent tail is backfilled', () => {
    const { deps } = open();
    // Contiguous m1..m10 delivered.
    for (let i = 1; i <= 10; i += 1) persistRemoteMessage(deps, snap(i, 'agent', 1000 + i, i));
    // Drift: a live event for m20 (high cursor) arrives while m11..m19 were never
    // delivered. The monotonic cursor jumps to 20, so /messages/sync (since=20)
    // returns nothing → m11..m19 are stranded on the server.
    persistRemoteMessage(deps, snap(20, 'agent', 1020, 20));
    expect(listMessages(deps, { buddyId: BUDDY }).map((m) => Number(m.id)))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]); // m11..m19 missing

    // Self-heal: the recent-tail backfill (POST /messages/recent) returns m11..m20
    // regardless of cursor; persisting them restores the display.
    for (let i = 11; i <= 20; i += 1) persistRemoteMessage(deps, snap(i, 'agent', 1000 + i, i));

    const recovered = listMessages(deps, { buddyId: BUDDY });
    assertDisplayInvariant(recovered);
    expect(recovered.map((m) => Number(m.id))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    deps.db.close();
  });
});
