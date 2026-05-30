/**
 * Runtime configuration for network endpoints.
 *
 * Telegram-baseline rule (PRD §1.4, TECH_SPEC §12.1): every Bot API call goes to
 * `{gateway}/bot{token}/{method}`. By default the gateway is the public Telegram
 * Bot API, so the app talks to *real* Telegram bots out of the box. A custom Agent
 * Gateway (which adds the auth API + trace/delta stream extensions) can be swapped
 * in by overriding `apiBase`/`gateway` via Expo `extra` (app.config) or at runtime.
 */
import Constants from "expo-constants";

type Extra = {
  gateway?: string;
  apiBase?: string;
  relayBase?: string;
  eas?: { projectId?: string };
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Only treat apiBase as a real backend when it's an http(s) URL — guards against
 *  null, "", "null", or any malformed manifest value falling through to fetch(). */
function normalizeApiBase(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  return t.replace(/\/+$/, "");
}

export const config = {
  /** Base for Telegram-compatible Bot API. */
  gateway: (typeof extra.gateway === "string" && extra.gateway.trim()) || "https://api.telegram.org",
  /**
   * Base for the extension Auth API + trace stream. When unset we run in
   * "dev/offline auth" mode (see AuthClient) and rely on plain Telegram for chat.
   */
  apiBase: normalizeApiBase(extra.apiBase),
  /**
   * Base for the push relay (separate self-owned service). When set, the app stops
   * polling Telegram getUpdates directly and pulls from the relay + receives Expo push.
   */
  relayBase: normalizeApiBase(extra.relayBase),
} as const;

/** True when a custom Agent Gateway is configured (enables phone auth + trace stream). */
export const hasBackend = config.apiBase != null;

/** True when a push relay is configured (enables background push + relay pull). */
export const pushEnabled = config.relayBase != null;

/** EAS projectId — required by expo-notifications getExpoPushTokenAsync. */
export const easProjectId =
  extra.eas?.projectId ?? (Constants.easConfig as { projectId?: string } | undefined)?.projectId ?? null;
