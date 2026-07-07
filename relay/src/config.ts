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
const helperEnabled = process.env.HELPER_ENABLED !== "false";
const ttsEnabled = process.env.TTS_ENABLED !== "false";
const llmBaseUrl = (process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
const llmConcurrency = Math.max(1, Number(process.env.LLM_CONCURRENCY ?? 4));

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
  helperEnabled,
  /** OpenAI-compatible model endpoint used by helper AI and TTS script rewriting. */
  llmBaseUrl,
  llmApiKey: process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? "not-needed",
  llmModel: process.env.LLM_MODEL ?? process.env.HELPER_MODEL ?? "gemini-3.5-flash",
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 32000),
  llmHelperMaxTokens: Number(process.env.LLM_HELPER_MAX_TOKENS ?? 1024),
  llmTtsMaxTokens: Number(process.env.LLM_TTS_MAX_TOKENS ?? 4096),
  llmConcurrency,
  ttsEnabled,
  ttsProvider: process.env.TTS_PROVIDER ?? "edge-tts",
  ttsVoice: process.env.TTS_VOICE ?? "ko-KR-InJoonNeural",
  ttsFallbackVoice: process.env.TTS_FALLBACK_VOICE ?? "ko-KR-HyunsuMultilingualNeural",
  ttsRate: process.env.TTS_RATE ?? "+8%",
  ttsCacheDir: process.env.TTS_CACHE_DIR ?? ".cache/tts",
  ttsMaxInputChars: Number(process.env.TTS_MAX_INPUT_CHARS ?? 6000),
  // FCM v1 (data-message wake channel for the phone-command pipe). The service
  // account JSON is downloaded from Firebase Console → Project settings →
  // Service accounts. Without it the command dispatch cannot wake the phone.
  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? "",
  fcmProjectId: process.env.FCM_PROJECT_ID ?? "agent-client-73b5b",
  fcmEnabled: !!process.env.FCM_SERVICE_ACCOUNT_JSON,
  // Master key that guards dev-only debug routes and MCP token minting.
  masterKeyRaw: rawKey ?? "",
  // How long a dispatched phone command waits for a result before giving up.
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS ?? 30_000),
  // When true, send_sms/send_media MCP tools require a relay-issued confirm token.
  mcpRequireConfirmToken: process.env.MCP_REQUIRE_CONFIRM_TOKEN === "true",
} as const;
