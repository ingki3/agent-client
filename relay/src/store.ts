/**
 * SQLite-backed store (better-sqlite3, synchronous). One poll loop per bot_id;
 * devices subscribe to bots; updates buffered per bot for app catch-up.
 */
import Database from "better-sqlite3";
import { config } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import type { HelperItem, NormalizedMessage, TgUpdate } from "./types.js";

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
  CREATE TABLE IF NOT EXISTS message_snapshots (
    peer_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    cursor INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (peer_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_message_snapshots_peer_cursor
    ON message_snapshots (peer_id, cursor);
  -- MTProto user-account sessions (GramJS). One Telegram account per device (single-user).
  CREATE TABLE IF NOT EXISTS user_sessions (
    device_id TEXT PRIMARY KEY,
    enc_session TEXT,                       -- encrypt(StringSession); null until signIn completes
    tg_user_id INTEGER,                     -- logged-in account's own id (from getMe)
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | active | revoked
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  -- Resolved peers (the bots/chats the user talks to). peer_id mirrors a bot_id on /pull.
  CREATE TABLE IF NOT EXISTS peers (
    device_id TEXT NOT NULL,
    owner_tg_user_id INTEGER,
    peer_id INTEGER NOT NULL,
    username TEXT,
    title TEXT,
    access_hash TEXT,                       -- int64 as string, for InputPeerUser
    created_at INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    local_seq INTEGER NOT NULL DEFAULT 0,   -- monotonic cursor; stands in for getUpdates offset
    PRIMARY KEY (device_id, peer_id)
  );
`);

function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn("peers", "owner_tg_user_id", "owner_tg_user_id INTEGER");
ensureColumn("peers", "created_at", "created_at INTEGER NOT NULL DEFAULT 0");
ensureColumn("peers", "last_used_at", "last_used_at INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_peers_owner ON peers(owner_tg_user_id, peer_id)");

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
export type UserSessionRow = {
  device_id: string;
  enc_session: string | null;
  tg_user_id: number | null;
  phone: string | null;
  status: string;
};
export type PeerRow = {
  device_id: string;
  owner_tg_user_id: number | null;
  peer_id: number;
  username: string | null;
  title: string | null;
  access_hash: string | null;
  created_at: number;
  last_used_at: number;
  local_seq: number;
};

function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function nextSnapshotCursor(peerId: number): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM message_snapshots WHERE peer_id=?")
    .get(peerId) as { cursor: number };
  return row.cursor;
}

function readSnapshot(peerId: number, messageId: number): NormalizedMessage | undefined {
  const row = db
    .prepare("SELECT payload_json FROM message_snapshots WHERE peer_id=? AND message_id=?")
    .get(peerId, messageId) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) as NormalizedMessage : undefined;
}

function comparableSnapshot(message: NormalizedMessage): Omit<NormalizedMessage, "cursor" | "updatedAt"> {
  return {
    id: message.id,
    peerId: message.peerId,
    messageId: message.messageId,
    role: message.role,
    text: message.text,
    status: message.status,
    date: message.date,
    ...(message.preview ? { preview: message.preview } : {}),
    ...(message.media ? { media: message.media } : {}),
    ...(message.helperItems ? { helperItems: message.helperItems } : {}),
    ...(message.inlineKeyboard !== undefined ? { inlineKeyboard: message.inlineKeyboard } : {}),
  };
}

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

  getMessageSnapshot(peerId: number, messageId: number): NormalizedMessage | undefined {
    return readSnapshot(peerId, messageId);
  },

  upsertMessageSnapshot(input: Omit<NormalizedMessage, "cursor" | "updatedAt">): { message: NormalizedMessage; changed: boolean } {
    const existing = readSnapshot(input.peerId, input.messageId);
    const now = Date.now();
    if (existing) {
      const status = existing.status === "complete" && input.text === existing.text
        ? "complete"
        : input.status;
      const next: NormalizedMessage = {
        ...existing,
        ...input,
        status,
        cursor: existing.cursor,
        updatedAt: now,
      };
      if (sameJson(comparableSnapshot(existing), comparableSnapshot(next))) {
        return { message: existing, changed: false };
      }
      const cursor = nextSnapshotCursor(input.peerId);
      const message = { ...next, cursor, updatedAt: now };
      db.prepare(
        `UPDATE message_snapshots SET cursor=?, payload_json=?, updated_at=? WHERE peer_id=? AND message_id=?`,
      ).run(cursor, JSON.stringify(message), now, input.peerId, input.messageId);
      return { message, changed: true };
    }

    const cursor = nextSnapshotCursor(input.peerId);
    const message: NormalizedMessage = { ...input, cursor, updatedAt: now };
    db.prepare(
      `INSERT INTO message_snapshots (peer_id, message_id, cursor, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.peerId, input.messageId, cursor, JSON.stringify(message), now);
    return { message, changed: true };
  },

  mergeSnapshotHelperItems(peerId: number, messageId: number, helperItems: HelperItem[]): { message: NormalizedMessage; changed: boolean } | undefined {
    const existing = readSnapshot(peerId, messageId);
    if (!existing) return undefined;
    return store.upsertMessageSnapshot({
      ...existing,
      helperItems,
      status: "complete",
    });
  },

  listMessageSnapshots(peerId: number, sinceCursor = 0, limit = 100, opts: { legacyCursorFallback?: boolean } = {}): NormalizedMessage[] {
    const max = db
      .prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM message_snapshots WHERE peer_id=?")
      .get(peerId) as { cursor: number };
    const lowerBound = opts.legacyCursorFallback !== false && sinceCursor > max.cursor ? 0 : sinceCursor;
    const rows = db
      .prepare(
        "SELECT payload_json FROM message_snapshots WHERE peer_id=? AND cursor>=? ORDER BY cursor ASC LIMIT ?",
      )
      .all(peerId, lowerBound, limit) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as NormalizedMessage);
  },

  // `since` is Telegram-getUpdates style: the NEXT expected update_id (the client sends
  // last_seen + 1), so the lower bound is inclusive (>=). Using > here dropped the message
  // whose id equalled the client's offset when it arrived a poll-cycle late. The client
  // dedupes by message id, so the inclusive bound never causes a visible duplicate.
  pullUpdates(botId: number, since: number, limit = 100): TgUpdate[] {
    const rows = db
      .prepare(
        "SELECT payload_json FROM updates WHERE bot_id=? AND update_id>=? ORDER BY update_id ASC LIMIT ?",
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
    const sessions = db.prepare("SELECT device_id, tg_user_id, status FROM user_sessions").all();
    return { bots, devices, sessions };
  },

  // ─── MTProto user sessions ────────────────────────────────────────────────
  upsertUserSession(s: { deviceId: string; phone?: string; status?: string }) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO user_sessions (device_id, phone, status, created_at, last_seen_at)
       VALUES (@id, @phone, @status, @now, @now)
       ON CONFLICT(device_id) DO UPDATE SET phone=COALESCE(@phone, phone),
         status=COALESCE(@status, status), last_seen_at=@now`,
    ).run({ id: s.deviceId, phone: s.phone ?? null, status: s.status ?? "pending", now });
  },

  setSessionString(deviceId: string, sessionString: string, tgUserId: number) {
    db.prepare(
      `UPDATE user_sessions SET enc_session=?, tg_user_id=?, status='active', last_seen_at=? WHERE device_id=?`,
    ).run(encrypt(sessionString), tgUserId, Date.now(), deviceId);
  },

  getUserSession(deviceId: string): UserSessionRow | undefined {
    return db.prepare("SELECT * FROM user_sessions WHERE device_id=?").get(deviceId) as
      | UserSessionRow
      | undefined;
  },

  /** Active sessions with a saved string — the set to reconnect on boot. */
  activeSessions(): UserSessionRow[] {
    return db
      .prepare("SELECT * FROM user_sessions WHERE status='active' AND enc_session IS NOT NULL")
      .all() as UserSessionRow[];
  },

  decryptSession(row: UserSessionRow): string {
    if (!row.enc_session) throw new Error("no session string");
    return decrypt(row.enc_session);
  },

  revokeSession(deviceId: string) {
    db.prepare("UPDATE user_sessions SET status='revoked', enc_session=NULL WHERE device_id=?").run(deviceId);
  },

  // ─── Peers (resolved bots/chats the user talks to) ────────────────────────
  upsertPeer(p: { deviceId: string; peerId: number; username?: string; title?: string; accessHash?: string }) {
    const session = store.getUserSession(p.deviceId);
    const now = Date.now();
    db.prepare(
      `INSERT INTO peers (device_id, owner_tg_user_id, peer_id, username, title, access_hash, created_at, last_used_at, local_seq)
       VALUES (@dev, @owner, @peer, @user, @title, @hash, @now, @now, 0)
       ON CONFLICT(device_id, peer_id) DO UPDATE SET
         owner_tg_user_id=COALESCE(@owner, owner_tg_user_id),
         username=COALESCE(@user, username), title=COALESCE(@title, title),
         access_hash=COALESCE(@hash, access_hash), last_used_at=@now`,
    ).run({
      dev: p.deviceId,
      owner: session?.tg_user_id ?? null,
      peer: p.peerId,
      user: p.username ?? null,
      title: p.title ?? null,
      hash: p.accessHash ?? null,
      now,
    });
  },

  listAccountPeers(deviceId: string): PeerRow[] {
    const session = store.getUserSession(deviceId);
    if (!session?.tg_user_id) {
      return db
        .prepare("SELECT * FROM peers WHERE device_id=? ORDER BY last_used_at DESC, created_at DESC")
        .all(deviceId) as PeerRow[];
    }
    return db
      .prepare(
        `SELECT *
         FROM (
           SELECT
             p.*,
             ROW_NUMBER() OVER (
               PARTITION BY p.peer_id
               ORDER BY p.last_used_at DESC, p.created_at DESC
             ) AS rn
           FROM peers p
           LEFT JOIN user_sessions s ON s.device_id = p.device_id
           WHERE p.owner_tg_user_id = @tg OR s.tg_user_id = @tg
         )
         WHERE rn = 1
         ORDER BY last_used_at DESC, created_at DESC`,
      )
      .all({ tg: session.tg_user_id }) as PeerRow[];
  },

  removeAccountPeer(deviceId: string, peerId: number) {
    const session = store.getUserSession(deviceId);
    if (!session?.tg_user_id) {
      db.prepare("DELETE FROM peers WHERE device_id=? AND peer_id=?").run(deviceId, peerId);
      return;
    }
    db.prepare(
      `DELETE FROM peers
       WHERE peer_id=@peer
         AND (owner_tg_user_id=@tg OR device_id IN (SELECT device_id FROM user_sessions WHERE tg_user_id=@tg))`,
    ).run({ peer: peerId, tg: session.tg_user_id });
  },

  getPeer(deviceId: string, peerId: number): PeerRow | undefined {
    return db.prepare("SELECT * FROM peers WHERE device_id=? AND peer_id=?").get(deviceId, peerId) as
      | PeerRow
      | undefined;
  },

  getAccountPeer(deviceId: string, peerId: number): PeerRow | undefined {
    const direct = store.getPeer(deviceId, peerId);
    if (direct) return direct;
    const session = store.getUserSession(deviceId);
    if (!session?.tg_user_id) return undefined;
    return db
      .prepare(
        `SELECT p.*
         FROM peers p
         LEFT JOIN user_sessions s ON s.device_id = p.device_id
         WHERE p.peer_id = @peer
           AND (p.owner_tg_user_id = @tg OR s.tg_user_id = @tg)
         ORDER BY p.last_used_at DESC, p.created_at DESC
         LIMIT 1`,
      )
      .get({ peer: peerId, tg: session.tg_user_id }) as PeerRow | undefined;
  },

  /** Atomically bump and return the next monotonic cursor for a peer's buffered updates. */
  nextPeerSeq(deviceId: string, peerId: number): number {
    const row = db
      .prepare(
        `UPDATE peers SET local_seq = local_seq + 1 WHERE device_id=? AND peer_id=? RETURNING local_seq`,
      )
      .get(deviceId, peerId) as { local_seq: number } | undefined;
    return row?.local_seq ?? 0;
  },
};
