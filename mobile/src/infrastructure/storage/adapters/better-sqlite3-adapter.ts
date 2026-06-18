// Jest 전용 어댑터. better-sqlite3 의 in-memory 모드로 expo-sqlite 와 동일한
// 표면을 흉내낸다. 프로덕션 번들에는 포함되지 않는다 (jest setup 에서만 import).

import type { Database, SqliteRunResult } from '../database';

interface BetterSqlite3Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface BetterSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): BetterSqlite3Statement;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  close(): void;
}

interface BetterSqlite3Module {
  (filename: string, options?: { memory?: boolean }): BetterSqlite3Database;
  new (filename: string, options?: { memory?: boolean }): BetterSqlite3Database;
}

export function createBetterSqlite3Database(filename = ':memory:'): Database {
   
  const BetterSqlite3 = require('better-sqlite3') as BetterSqlite3Module;
  const db = new BetterSqlite3(filename);
  return wrap(db);
}

function wrap(db: BetterSqlite3Database): Database {
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []): SqliteRunResult {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      const id = result.lastInsertRowid;
      return {
        changes: result.changes,
        lastInsertRowId: typeof id === 'bigint' ? Number(id) : id,
      };
    },
    all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    first<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const row = db.prepare(sql).get(...params);
      return (row ?? null) as T | null;
    },
    transaction<T>(fn: () => T): T {
      const wrapped = db.transaction(fn as (...a: unknown[]) => unknown) as () => T;
      return wrapped();
    },
    close() {
      db.close();
    },
  };
}
