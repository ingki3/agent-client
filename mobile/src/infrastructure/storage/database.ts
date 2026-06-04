// SQLite 인프라 — TECH_SPEC §11.4 (migration helper + version table).
// expo-sqlite 와 better-sqlite3(테스트용 노드 어댑터)를 공통 인터페이스로 묶어 사용한다.
// SQL 자체는 두 엔진에서 동일하게 동작하도록 표준 ANSI 서브셋만 사용한다.

export interface SqliteRunResult {
  changes: number;
  lastInsertRowId: number | null;
}

export interface Database {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): SqliteRunResult;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface Migration {
  version: number;
  up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS buddies (
          id TEXT PRIMARY KEY,
          username TEXT,
          display_name TEXT NOT NULL,
          icon_url TEXT,
          trace_supported INTEGER NOT NULL DEFAULT 0,
          last_message_preview TEXT,
          last_message_at INTEGER,
          unread_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          client_message_id TEXT UNIQUE NOT NULL,
          buddy_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          trace_id TEXT,
          FOREIGN KEY (buddy_id) REFERENCES buddies(id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_buddy_created
          ON messages (buddy_id, created_at);

        CREATE TABLE IF NOT EXISTS traces (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          nodes BLOB NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id)
        );

        CREATE TABLE IF NOT EXISTS outbox (
          message_id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL,
          text TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          enqueued_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id)
        );
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        ALTER TABLE messages ADD COLUMN preview_json TEXT;
        ALTER TABLE messages ADD COLUMN helper_items_json TEXT;
        ALTER TABLE messages ADD COLUMN inline_keyboard_json TEXT;
        ALTER TABLE messages ADD COLUMN attachments_json TEXT;
      `);
    },
  },
];

const VERSION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`;

export function getCurrentSchemaVersion(db: Database): number {
  db.exec(VERSION_TABLE_SQL);
  const row = db.first<{ version: number }>(
    'SELECT MAX(version) AS version FROM schema_version',
  );
  return row?.version ?? 0;
}

export function applyMigrations(db: Database, migrations: Migration[] = MIGRATIONS): number {
  db.exec(VERSION_TABLE_SQL);
  const current = getCurrentSchemaVersion(db);
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version,
        Date.now(),
      ]);
    });
  }

  return getCurrentSchemaVersion(db);
}
