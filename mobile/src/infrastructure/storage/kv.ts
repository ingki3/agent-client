/**
 * Native key-value persistence (iOS/Android) backed by expo-sqlite — a single `kv`
 * table of JSON blobs (TECH_SPEC §1.2). Falls back to in-memory if SQLite fails to
 * open. The web build uses `kv.web.ts` (Metro platform resolution) to avoid bundling
 * the SQLite wasm worker.
 *
 * JSON-blob-per-key keeps migrations trivial for the small MVP dataset; a normalized
 * schema can replace this behind the same interface later.
 */
import * as SQLite from "expo-sqlite";

const memory = new Map<string, string>();
let dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync("agentclient.db");
        await db.execAsync("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
        return db;
      } catch {
        return null; // fall back to in-memory
      }
    })();
  }
  return dbPromise;
}

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const db = await getDb();
    let raw: string | null;
    if (db) {
      const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
      raw = row?.value ?? null;
    } else {
      raw = memory.get(key) ?? null;
    }
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    const db = await getDb();
    if (db) {
      await db.runAsync(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, raw],
      );
    } else {
      memory.set(key, raw);
    }
  },

  async remove(key: string): Promise<void> {
    const db = await getDb();
    if (db) await db.runAsync("DELETE FROM kv WHERE key = ?", [key]);
    else memory.delete(key);
  },

  async clear(): Promise<void> {
    const db = await getDb();
    if (db) await db.runAsync("DELETE FROM kv");
    else memory.clear();
  },
};

export { KvKeys } from "./kvKeys";
