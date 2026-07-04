/**
 * FCM v1 sender — the wake channel for the phone-command pipe.
 *
 * The relay sends a HIGH-PRIORITY DATA-ONLY message (no notification block) so
 * Android delivers it to our own FirebaseMessagingService even when the app is
 * backgrounded or swiped away, without showing the user a banner. This is
 * distinct from the Expo-push path (push.ts), which is for user-visible chat
 * notifications.
 *
 * Requires a Firebase service-account JSON (FCM_SERVICE_ACCOUNT_JSON = path).
 * Without it, fcm.enabled is false and sendCommand throws a clear error.
 */
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { config } from "../config.js";
import { log } from "../log.js";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let jwtClient: JWT | null = null;
let loadError: string | null = null;

function getClient(): JWT {
  if (jwtClient) return jwtClient;
  if (!config.fcmServiceAccountJson) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not set — cannot send FCM commands");
  }
  if (loadError) throw new Error(loadError);
  try {
    const raw = readFileSync(config.fcmServiceAccountJson, "utf8");
    const sa = JSON.parse(raw) as { client_email: string; private_key: string; project_id?: string };
    jwtClient = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [FCM_SCOPE] });
    return jwtClient;
  } catch (e) {
    loadError = `failed to load FCM service account: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(loadError);
  }
}

export interface PhoneCommand {
  correlationId: string;
  tool: string;
  /** JSON-encoded args; FCM data values must be strings. */
  args: string;
}

export const fcm = {
  get enabled() {
    return config.fcmEnabled;
  },

  /** Send a data-only high-priority command to one device's FCM token. */
  async sendCommand(fcmToken: string, cmd: PhoneCommand): Promise<void> {
    const client = getClient();
    const { token: accessToken } = await client.getAccessToken();
    if (!accessToken) throw new Error("FCM: failed to obtain access token");

    const url = `https://fcm.googleapis.com/v1/projects/${config.fcmProjectId}/messages:send`;
    const body = {
      message: {
        token: fcmToken,
        android: { priority: "high" as const },
        // Data-only: no `notification` block, so no banner and our service handles it.
        data: {
          correlationId: cmd.correlationId,
          tool: cmd.tool,
          args: cmd.args,
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FCM send failed ${res.status}: ${text.slice(0, 300)}`);
    }
    log.info(`fcm command sent tool=${cmd.tool} corr=${cmd.correlationId}`);
  },
};
