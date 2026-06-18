// Production adapter — expo-sqlite >= 14 동기 API 를 공통 Database 인터페이스에 맞춘다.
// Jest 환경에서는 native binding 을 로드할 수 없으므로 이 모듈은 빌드/런타임 전용이다.

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import type { Database, SqliteRunResult } from '../database';

export function createExpoSqliteDatabase(name: string): Database {
  const db: SQLiteDatabase = openDatabaseSync(name);
  return wrap(db);
}

function wrap(db: SQLiteDatabase): Database {
  return {
    exec(sql) {
      db.execSync(sql);
    },
    run(sql, params = []): SqliteRunResult {
      const result = db.runSync(sql, params as never);
      return {
        changes: result.changes ?? 0,
        lastInsertRowId:
          typeof result.lastInsertRowId === 'number' ? result.lastInsertRowId : null,
      };
    },
    all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return db.getAllSync<T>(sql, params as never) as T[];
    },
    first<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const row = db.getFirstSync<T>(sql, params as never);
      return (row ?? null) as T | null;
    },
    transaction<T>(fn: () => T): T {
      let out!: T;
      db.withTransactionSync(() => {
        out = fn();
      });
      return out;
    },
    close() {
      db.closeSync();
    },
  };
}
