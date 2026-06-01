/**
 * Relay configuration from environment.
 *
 * RELAY_MASTER_KEY is required in production — it encrypts bot tokens at rest
 * (AES-256-GCM). In dev, if unset, a fixed dev key is used so the service boots,
 * with a loud warning (never use that key for real tokens).
 */
import { createHash } from "node:crypto";

function deriveDevKey(): Buffer {
  // Deterministic dev-only key so a restart can still decrypt the dev DB.
  return createHash("sha256").update("agent-client-relay-dev-key").digest();
}

const rawKey = process.env.RELAY_MASTER_KEY;

// Telegram MTProto (user-account) credentials from my.telegram.org. Required only for
// the user-session path (GramJS); the legacy bot-token push path works without them.
const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: process.env.RELAY_DB ?? "relay.db",
  /** 32-byte key for AES-256-GCM (bot tokens + MTProto session strings at rest). */
  masterKey: rawKey ? createHash("sha256").update(rawKey).digest() : deriveDevKey(),
  isDevKey: !rawKey,
  /** How long buffered updates are retained for app catch-up. */
  updateTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** getUpdates long-poll window (seconds). */
  pollTimeoutSec: 25,
  /** MTProto app credentials (my.telegram.org). */
  apiId,
  apiHash,
  /** Whether the user-account (MTProto) path is configured. */
  mtprotoEnabled: !!(apiId && apiHash),
} as const;
