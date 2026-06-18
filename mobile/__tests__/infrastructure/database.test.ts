import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import {
  applyMigrations,
  getCurrentSchemaVersion,
  MIGRATIONS,
  type Database,
} from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessageSyncStateRepository } from '@/infrastructure/storage/repositories/message-sync-state-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';
import { TracesRepository } from '@/infrastructure/storage/repositories/traces-repo';

function openMigratedDb(): Database {
  const db = createBetterSqlite3Database();
  applyMigrations(db);
  return db;
}

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((migration) => migration.version));

describe('Database migration', () => {
  it('applies v0 -> v1 and records schema_version', () => {
    const db = createBetterSqlite3Database();
    expect(getCurrentSchemaVersion(db)).toBe(0);
    const reached = applyMigrations(db);
    expect(reached).toBe(LATEST_SCHEMA_VERSION);
    expect(getCurrentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('is idempotent — second run does not change version', () => {
    const db = openMigratedDb();
    expect(applyMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(applyMigrations(db, MIGRATIONS)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('PRAGMA table_info reports expected columns', () => {
    const db = openMigratedDb();
    const buddyCols = db.all<TableInfoRow>('PRAGMA table_info(buddies)').map((c) => c.name);
    expect(buddyCols).toEqual(
      expect.arrayContaining([
        'id',
        'username',
        'display_name',
        'icon_url',
        'trace_supported',
        'last_message_preview',
        'last_message_at',
        'unread_count',
        'created_at',
      ]),
    );

    const messageCols = db.all<TableInfoRow>('PRAGMA table_info(messages)').map((c) => c.name);
    expect(messageCols).toEqual(
      expect.arrayContaining([
        'id',
        'client_message_id',
        'buddy_id',
        'role',
        'text',
        'status',
        'created_at',
        'trace_id',
        'preview_json',
        'helper_items_json',
        'inline_keyboard_json',
        'attachments_json',
      ]),
    );

    const traceCols = db.all<TableInfoRow>('PRAGMA table_info(traces)').map((c) => c.name);
    expect(traceCols).toEqual(
      expect.arrayContaining(['id', 'message_id', 'nodes', 'updated_at']),
    );

    const outboxCols = db.all<TableInfoRow>('PRAGMA table_info(outbox)').map((c) => c.name);
    expect(outboxCols).toEqual(
      expect.arrayContaining([
        'message_id',
        'buddy_id',
        'text',
        'retry_count',
        'last_error',
        'enqueued_at',
      ]),
    );

    const syncStateCols = db
      .all<TableInfoRow>('PRAGMA table_info(message_sync_state)')
      .map((c) => c.name);
    expect(syncStateCols).toEqual(
      expect.arrayContaining(['peer_id', 'cursor', 'updated_at']),
    );

    db.close();
  });
});

describe('Repository round-trips', () => {
  it('persists and retrieves a buddy', () => {
    const db = openMigratedDb();
    const repo = new BuddiesRepository(db);
    repo.upsert({
      id: 'b1',
      username: 'buddy_bot',
      displayName: 'Buddy',
      iconUrl: null,
      traceSupported: true,
      lastMessagePreview: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: 1_000,
    });
    expect(repo.findById('b1')?.displayName).toBe('Buddy');
    expect(repo.listAll()).toHaveLength(1);
    repo.remove('b1');
    expect(repo.findById('b1')).toBeNull();
    db.close();
  });

  it('insert + updateStatus + updateServerId on messages', () => {
    const db = openMigratedDb();
    new BuddiesRepository(db).upsert({
      id: 'b1',
      username: 'b',
      displayName: 'B',
      iconUrl: null,
      traceSupported: false,
      lastMessagePreview: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: 1,
    });
    const repo = new MessagesRepository(db);
    repo.insert({
      id: null,
      clientMessageId: 'cm-1',
      buddyId: 'b1',
      role: 'user',
      text: 'hi',
      status: 'sending',
      createdAt: 2,
      traceId: null,
    });
    repo.updateServerId('cm-1', 'srv-100');
    repo.updateStatus('cm-1', 'sent');
    const after = repo.findByClientMessageId('cm-1');
    expect(after?.id).toBe('srv-100');
    expect(after?.status).toBe('sent');
    expect(repo.listByBuddy('b1')).toHaveLength(1);
    db.close();
  });

  it('trace blob round-trip preserves nodes', () => {
    const db = openMigratedDb();
    new BuddiesRepository(db).upsert({
      id: 'b1',
      username: 'b',
      displayName: 'B',
      iconUrl: null,
      traceSupported: true,
      lastMessagePreview: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: 1,
    });
    new MessagesRepository(db).insert({
      id: 'm1',
      clientMessageId: 'cm-1',
      buddyId: 'b1',
      role: 'agent',
      text: '',
      status: 'sent',
      createdAt: 2,
      traceId: null,
    });
    const repo = new TracesRepository(db);
    repo.upsert({
      id: 't1',
      messageId: 'm1',
      nodes: [
        { kind: 'thinking', seq: 0, startedAt: 1, step: 'plan', summary: '...' },
        {
          kind: 'tool_call',
          seq: 1,
          startedAt: 2,
          id: 'tc-1',
          name: 'search',
          args: { q: 'foo' },
        },
      ],
      updatedAt: 3,
    });
    const trace = repo.findByMessageId('m1');
    expect(trace?.nodes).toHaveLength(2);
    expect(trace?.nodes[0]?.kind).toBe('thinking');
    db.close();
  });

  it('outbox enqueue + remove updates count', () => {
    const db = openMigratedDb();
    new BuddiesRepository(db).upsert({
      id: 'b1',
      username: 'b',
      displayName: 'B',
      iconUrl: null,
      traceSupported: false,
      lastMessagePreview: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: 1,
    });
    new MessagesRepository(db).insert({
      id: null,
      clientMessageId: 'cm-1',
      buddyId: 'b1',
      role: 'user',
      text: 'failed-send',
      status: 'failed',
      createdAt: 2,
      traceId: null,
    });
    const repo = new OutboxRepository(db);
    repo.enqueue({
      messageId: 'cm-1',
      buddyId: 'b1',
      text: 'failed-send',
      retryCount: 0,
      lastError: 'network_error',
      enqueuedAt: 3,
    });
    expect(repo.count()).toBe(1);
    expect(repo.listOldestFirst()[0]?.messageId).toBe('cm-1');
    repo.remove('cm-1');
    expect(repo.count()).toBe(0);
    db.close();
  });

  it('message sync state stores and advances cursor per peer', () => {
    const db = openMigratedDb();
    const repo = new MessageSyncStateRepository(db);

    expect(repo.getCursor('1001')).toBe(0);
    repo.advanceCursor('1001', 10, 1_000);
    expect(repo.getCursor('1001')).toBe(10);

    repo.advanceCursor('1001', 8, 2_000);
    expect(repo.getCursor('1001')).toBe(10);

    repo.advanceCursor('1001', 11, 3_000);
    expect(repo.getCursor('1001')).toBe(11);
    db.close();
  });
});
