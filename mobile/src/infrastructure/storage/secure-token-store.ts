/**
 * SecureTokenStore — auth token persistence (TECH §3.5, §5.2).
 *
 * Backed by expo-secure-store:
 *   iOS  : Keychain (kSecAttrAccessibleAfterFirstUnlock — set via getSecureStoreOptions)
 *   Android: EncryptedSharedPreferences (AES-256)
 *
 * Keys carry a version suffix so a future token format change can land alongside a one-shot
 * migration (TECH §5 mentions `access_token_v2`).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_VERSION = 'v1';
export const TokenKeys = {
  accessToken: `access_token_${KEY_VERSION}`,
  refreshToken: `refresh_token_${KEY_VERSION}`,
  expiresAt: `token_expires_at_${KEY_VERSION}`,
  phoneNumber: `auth_phone_${KEY_VERSION}`,
} as const;

const IOS_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function options(): SecureStore.SecureStoreOptions | undefined {
  return Platform.OS === 'ios' ? IOS_OPTIONS : undefined;
}

export type AuthTokenSnapshot = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // unix ms
  phoneNumber: string | null;
};

async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, options());
}

async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, options());
}

async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, options());
}

export const secureTokenStore = {
  async save(snapshot: AuthTokenSnapshot): Promise<void> {
    await Promise.all([
      setItem(TokenKeys.accessToken, snapshot.accessToken),
      snapshot.refreshToken
        ? setItem(TokenKeys.refreshToken, snapshot.refreshToken)
        : deleteItem(TokenKeys.refreshToken),
      setItem(TokenKeys.expiresAt, String(snapshot.expiresAt)),
      snapshot.phoneNumber
        ? setItem(TokenKeys.phoneNumber, snapshot.phoneNumber)
        : deleteItem(TokenKeys.phoneNumber),
    ]);
  },

  async load(): Promise<AuthTokenSnapshot | null> {
    const [access, refresh, expiresAtStr, phone] = await Promise.all([
      getItem(TokenKeys.accessToken),
      getItem(TokenKeys.refreshToken),
      getItem(TokenKeys.expiresAt),
      getItem(TokenKeys.phoneNumber),
    ]);
    if (!access) return null;
    const expiresAt = expiresAtStr ? Number(expiresAtStr) : 0;
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      phoneNumber: phone,
    };
  },

  async clear(): Promise<void> {
    await Promise.all([
      deleteItem(TokenKeys.accessToken),
      deleteItem(TokenKeys.refreshToken),
      deleteItem(TokenKeys.expiresAt),
      deleteItem(TokenKeys.phoneNumber),
    ]);
  },
};

export type SecureTokenStore = typeof secureTokenStore;
