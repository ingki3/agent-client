/**
 * BotTokenStore — per-buddy bot 토큰 영속화 (PRD §5.2, TECH_SPEC §5).
 *
 * 토큰 자체는 SQLite (`buddies` 테이블) 에 저장되지 않으며, 항상
 * expo-secure-store (iOS Keychain / Android EncryptedSharedPreferences) 에만 둔다.
 *
 * 키 패턴: `bot_token__<buddyId>` (buddyId 는 Telegram bot.id 의 string 표현).
 * 별도 prefix 로 auth 토큰 (`access_token_v1` 등) 과 네임스페이스 충돌 없이 분리.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { BuddyId } from '@/domain/entities/Buddy';

const BOT_TOKEN_PREFIX = 'bot_token__';

const IOS_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function options(): SecureStore.SecureStoreOptions | undefined {
  return Platform.OS === 'ios' ? IOS_OPTIONS : undefined;
}

function keyFor(buddyId: BuddyId): string {
  return `${BOT_TOKEN_PREFIX}${buddyId}`;
}

export const botTokenStore = {
  async save(buddyId: BuddyId, token: string): Promise<void> {
    await SecureStore.setItemAsync(keyFor(buddyId), token, options());
  },

  async load(buddyId: BuddyId): Promise<string | null> {
    return SecureStore.getItemAsync(keyFor(buddyId), options());
  },

  async remove(buddyId: BuddyId): Promise<void> {
    await SecureStore.deleteItemAsync(keyFor(buddyId), options());
  },
};

export type BotTokenStore = typeof botTokenStore;
