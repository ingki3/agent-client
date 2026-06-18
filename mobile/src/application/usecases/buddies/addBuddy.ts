/**
 * addBuddy — 봇 토큰으로 친구(에이전트) 추가 (PRD UC-02 / FR-05~07).
 *
 * 흐름 (TECH §2.4):
 *   1. `BotApiClient.getMe(token)` 로 토큰 검증 + 봇 식별자 획득
 *   2. 중복 검사 (`buddiesRepo.findById(bot.id)`) → 있으면 DuplicateBuddyError
 *   3. SQLite + SecureStore 동시 영속화 (DB 는 transaction, token 은 best-effort 별도 호출)
 *   4. `/start` 자동 전송 — 실패해도 친구 등록은 유지 (FR-07 단서)
 *
 * 반환값은 등록된 Buddy + /start 송신 결과. UI 는 결과로 토스트/배너를 띄운다.
 */
import { tgUserToBotIdentity } from '@/infrastructure/api/mappers';

import type { Buddy } from '@/domain/entities/Buddy';

import { DuplicateBuddyError, type BuddiesUseCaseDeps } from './types';

export interface AddBuddyInput {
  token: string;
  /** S-13 미리보기에서 사용자가 편집 가능. 비우면 username → first_name 순으로 fallback. */
  displayName?: string;
}

export interface AddBuddyResult {
  buddy: Buddy;
  /** `/start` 전송 성공 여부. 실패는 toast 로 표시만 하고 등록은 유지. */
  startSent: boolean;
  startError?: unknown;
}

export async function addBuddy(
  deps: BuddiesUseCaseDeps,
  input: AddBuddyInput,
): Promise<AddBuddyResult> {
  const { db, buddiesRepo, tokenStore, botApi } = deps;

  // 1. 토큰 검증 + 봇 identity. 4xx/5xx 는 BotApiError 로 자연 전파.
  const tgUser = await botApi.getMe(input.token);
  const identity = tgUserToBotIdentity(tgUser);

  // 2. 중복 검사. 이미 등록되어 있으면 즉시 종료 — 토큰도 다시 쓰지 않음.
  const existing = buddiesRepo.findById(identity.id);
  if (existing) {
    throw new DuplicateBuddyError({ id: existing.id, displayName: existing.displayName });
  }

  // 3. Buddy entity 구성. displayName 우선순위: input > username > first_name.
  const displayName =
    input.displayName?.trim() || identity.username || identity.firstName;
  const now = Date.now();
  const buddy: Buddy = {
    id: identity.id,
    username: identity.username ?? '',
    displayName,
    iconUrl: null,
    traceSupported: false,
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: now,
  };

  // 4. 영속화. SQLite insert 와 SecureStore save 를 묶는다.
  // SecureStore 가 비동기라 진짜 ACID transaction 은 안 되지만,
  // 둘 중 SecureStore 가 실패하면 SQLite row 를 롤백해 inconsistency 방지.
  db.transaction(() => {
    buddiesRepo.upsert(buddy);
  });
  try {
    await tokenStore.save(buddy.id, input.token);
  } catch (err) {
    buddiesRepo.remove(buddy.id);
    throw err;
  }

  // 5. /start 자동 전송 (FR-07). best-effort.
  let startSent = false;
  let startError: unknown;
  try {
    await botApi.sendMessage(input.token, { chat_id: buddy.id, text: '/start' });
    startSent = true;
  } catch (err) {
    startError = err;
  }

  return { buddy, startSent, startError };
}
