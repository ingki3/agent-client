/**
 * SQLite-backed store (better-sqlite3, synchronous). One poll loop per bot_id;
 * devices subscribe to bots; updates buffered per bot for app catch-up.
 */
import Database from "better-sqlite3";
import { config } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import type { TgUpdate } from "./types.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_secret_hash TEXT NOT NULL,
    expo_push_token TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bots (
    bot_id INTEGER PRIMARY KEY,
    gateway TEXT NOT NULL,
    enc_bot_token TEXT NOT NULL,
    tg_offset INTEGER NOT NULL DEFAULT 0,
    last_poll_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    device_id TEXT NOT NULL,
    bot_id INTEGER NOT NULL,
    buddy_id TEXT NOT NULL,
    PRIMARY KEY (device_id, bot_id)
  );
  CREATE TABLE IF NOT EXISTS updates (
    bot_id INTEGER NOT NULL,
    update_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, update_id)
  );
`);

export type DeviceRow = {
  device_id: string;
  device_secret_hash: string;
  expo_push_token: string;
  platform: string;
};
export type BotRow = {
  bot_id: number;
  gateway: string;
  enc_bot_token: string;
  tg_offset: number;
  status: string;
};
export type PushTarget = { device_id: string; expo_push_token: string; buddy_id: string };

export const store = {
  upsertDevice(d: { deviceId: string; secretHash: string; expoPushToken: string; platform: string }) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO devices (device_id, device_secret_hash, expo_push_token, platform, created_at, last_seen_at)
       VALUES (@id, @hash, @tok, @plat, @now, @now)
       ON CONFLICT(device_id) DO UPDATE SET expo_push_token=@tok, platform=@plat, last_seen_at=@now`,
    ).run({ id: d.deviceId, hash: d.secretHash, tok: d.expoPushToken, plat: d.platform, now });
  },

  getDevice(deviceId: string): DeviceRow | undefined {
    return db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId) as DeviceRow | undefined;
  },

  upsertBot(b: { botId: number; gateway: string; botToken: string }) {
    const existing = db.prepare("SELECT bot_id FROM bots WHERE bot_id = ?").get(b.botId);
    if (existing) {
      db.prepare("UPDATE bots SET gateway=@gw, status='active' WHERE bot_id=@id").run({
        gw: b.gateway,
        id: b.botId,
      });
    } else {
      db.prepare(
        `INSERT INTO bots (bot_id, gateway, enc_bot_token, tg_offset, status)
         VALUES (@id, @gw, @enc, 0, 'active')`,
      ).run({ id: b.botId, gw: b.gateway, enc: encrypt(b.botToken) });
    }
  },

  subscribe(deviceId: string, botId: number, buddyId: string) {
    db.prepare(
      `INSERT INTO subscriptions (device_id, bot_id, buddy_id) VALUES (?, ?, ?)
       ON CONFLICT(device_id, bot_id) DO UPDATE SET buddy_id=excluded.buddy_id`,
    ).run(deviceId, botId, buddyId);
  },

  unsubscribe(deviceId: string, botId?: number) {
    if (botId == null) db.prepare("DELETE FROM subscriptions WHERE device_id = ?").run(deviceId);
    else db.prepare("DELETE FROM subscriptions WHERE device_id = ? AND bot_id = ?").run(deviceId, botId);
  },

  removeDevice(deviceId: string) {
    db.prepare("DELETE FROM subscriptions WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM devices WHERE device_id = ?").run(deviceId);
  },

  /** Bots that still have ≥1 subscription and are active — the set of loops to run. */
  activeBots(): BotRow[] {
    return db
      .prepare(
        `SELECT b.* FROM bots b
         WHERE b.status='active' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.bot_id=b.bot_id)`,
      )
      .all() as BotRow[];
  },

  /** Reap bots with no subscribers: drop the loop and delete the encrypted token. */
  reapOrphanBots(): number[] {
    const orphans = db
      .prepare(`SELECT bot_id FROM bots WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.bot_id=bots.bot_id)`)
      .all() as { bot_id: number }[];
    for (const o of orphans) db.prepare("DELETE FROM bots WHERE bot_id = ?").run(o.bot_id);
    return orphans.map((o) => o.bot_id);
  },

  decryptToken(b: BotRow): string {
    return decrypt(b.enc_bot_token);
  },

  setOffset(botId: number, offset: number) {
    db.prepare("UPDATE bots SET tg_offset=?, last_poll_at=? WHERE bot_id=?").run(offset, Date.now(), botId);
  },

  pushTargets(botId: number): PushTarget[] {
    return db
      .prepare(
        `SELECT d.device_id, d.expo_push_token, s.buddy_id
         FROM subscriptions s JOIN devices d ON d.device_id = s.device_id
         WHERE s.bot_id = ?`,
      )
      .all(botId) as PushTarget[];
  },

  hasUpdate(botId: number, updateId: number): boolean {
    return !!db.prepare("SELECT 1 FROM updates WHERE bot_id=? AND update_id=?").get(botId, updateId);
  },

  insertUpdate(botId: number, u: TgUpdate) {
    db.prepare(
      "INSERT OR IGNORE INTO updates (bot_id, update_id, payload_json, received_at) VALUES (?, ?, ?, ?)",
    ).run(botId, u.update_id, JSON.stringify(u), Date.now());
  },

  pullUpdates(botId: number, since: number, limit = 100): TgUpdate[] {
    const rows = db
      .prepare(
        "SELECT payload_json FROM updates WHERE bot_id=? AND update_id>? ORDER BY update_id ASC LIMIT ?",
      )
      .all(botId, since, limit) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as TgUpdate);
  },

  /** Resolve botId from a device's subscription (for /pull auth scoping). */
  subscriptionBuddy(deviceId: string, botId: number): string | undefined {
    const r = db
      .prepare("SELECT buddy_id FROM subscriptions WHERE device_id=? AND bot_id=?")
      .get(deviceId, botId) as { buddy_id: string } | undefined;
    return r?.buddy_id;
  },

  pruneUpdates() {
    db.prepare("DELETE FROM updates WHERE received_at < ?").run(Date.now() - config.updateTtlMs);
  },

  removePushToken(expoPushToken: string) {
    // Token rejected by Expo (DeviceNotRegistered) → drop the device + its subs.
    const dev = db.prepare("SELECT device_id FROM devices WHERE expo_push_token=?").get(expoPushToken) as
      | { device_id: string }
      | undefined;
    if (dev) store.removeDevice(dev.device_id);
  },

  healthSnapshot() {
    const bots = db.prepare("SELECT bot_id, tg_offset, last_poll_at, status FROM bots").all();
    const devices = (db.prepare("SELECT COUNT(*) c FROM devices").get() as { c: number }).c;
    return { bots, devices };
  },
};
