/**
 * Web key-value persistence — uses localStorage when available, else in-memory. The web
 * build never bundles expo-sqlite (the wasm worker can't be statically exported), so
 * this variant is selected by Metro's platform resolution for `kv` on web.
 */
const memory = new Map<string, string>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const raw = store()?.getItem(key) ?? memory.get(key) ?? null;
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    const s = store();
    if (s) s.setItem(key, raw);
    else memory.set(key, raw);
  },

  async remove(key: string): Promise<void> {
    store()?.removeItem(key);
    memory.delete(key);
  },

  async clear(): Promise<void> {
    store()?.clear();
    memory.clear();
  },
};

export { KvKeys } from "./kvKeys";
