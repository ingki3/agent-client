/**
 * Secure token storage (TECH_SPEC §5).
 *
 * - auth token (+ refresh) — the app's own session credential
 * - per-buddy bot tokens — never leave the device unencrypted
 *
 * Backed by expo-secure-store on native (iOS Keychain / Android EncryptedSharedPreferences).
 * On web (`expo start --web`) SecureStore is unavailable, so we degrade to an in-memory
 * map — acceptable for the dev/preview build only.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const memory = new Map<string, string>();
const isNative = Platform.OS === "ios" || Platform.OS === "android";

// SecureStore keys must match [A-Za-z0-9._-]; bot tokens contain ':' so we hash-safe them.
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export const secureStore = {
  async get(key: string): Promise<string | null> {
    const k = safeKey(key);
    if (!isNative) return memory.get(k) ?? null;
    return SecureStore.getItemAsync(k);
  },

  async set(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    if (!isNative) {
      memory.set(k, value);
      return;
    }
    await SecureStore.setItemAsync(k, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  },

  async remove(key: string): Promise<void> {
    const k = safeKey(key);
    if (!isNative) {
      memory.delete(k);
      return;
    }
    await SecureStore.deleteItemAsync(k);
  },
};

export const SecureKeys = {
  authToken: "access_token_v1",
  refreshToken: "refresh_token_v1",
  phoneNumber: "phone_number_v1",
  botToken: (buddyId: string) => `bot_token_v1_${buddyId}`,
  expoPushToken: "expo_push_token_v1",
  deviceId: "device_id_v1",
  deviceSecret: "device_secret_v1",
} as const;
