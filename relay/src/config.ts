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

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dbPath: process.env.RELAY_DB ?? "relay.db",
  /** 32-byte key for AES-256-GCM. */
  masterKey: rawKey ? createHash("sha256").update(rawKey).digest() : deriveDevKey(),
  isDevKey: !rawKey,
  /** How long buffered updates are retained for app catch-up. */
  updateTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** getUpdates long-poll window (seconds). */
  pollTimeoutSec: 25,
} as const;
