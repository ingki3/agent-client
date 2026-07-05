/**
 * JS wrapper over the native `CommandBridge` module (Android only).
 *
 * Two jobs, both foreground:
 *   - getFcmToken(): the raw FCM device token to register as the wake channel.
 *   - mirrorCredentials(): copy relayBase/deviceSecret/deviceId into native
 *     EncryptedSharedPreferences so the background FCM command service can
 *     authenticate its result callbacks without a JS runtime.
 *
 * All calls no-op (return null/false) off Android or when the native module is
 * absent (e.g. Expo Go), so the app runs unchanged where the pipe isn't built.
 */
import { NativeModules, Platform } from "react-native";

import { config } from "@/infrastructure/config";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";

type CommandBridgeNative = {
  setCredentials(relayBase: string, deviceSecret: string, deviceId: string): Promise<boolean>;
  clearCredentials(): Promise<boolean>;
  getFcmToken(): Promise<string>;
};

const native: CommandBridgeNative | undefined =
  Platform.OS === "android" ? (NativeModules.CommandBridge as CommandBridgeNative | undefined) : undefined;

export const commandBridge = {
  available(): boolean {
    return !!native;
  },

  async getFcmToken(): Promise<string | null> {
    if (!native) return null;
    try {
      const token = await native.getFcmToken();
      return token || null;
    } catch (e) {
      console.warn("[command] getFcmToken failed", e);
      return null;
    }
  },

  /** Mirror the current relay credentials into native storage. Call after register
   *  (once deviceSecret exists). No-op if any credential is missing. */
  async mirrorCredentials(): Promise<void> {
    if (!native) return;
    const relayBase = config.relayBase;
    const deviceSecret = await secureStore.get(SecureKeys.deviceSecret);
    const deviceId = await secureStore.get(SecureKeys.deviceId);
    if (!relayBase || !deviceSecret || !deviceId) return;
    try {
      await native.setCredentials(relayBase, deviceSecret, deviceId);
    } catch (e) {
      console.warn("[command] mirrorCredentials failed", e);
    }
  },

  async clearCredentials(): Promise<void> {
    if (!native) return;
    try {
      await native.clearCredentials();
    } catch {
      // best-effort
    }
  },
};
