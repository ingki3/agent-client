/**
 * listBuddies — SQLite 의 buddies 행을 그대로 반환 (PRD UC-02 / FR-09).
 *
 * 화면 (S-10) 은 결과를 `useBuddiesStore.setAll()` 로 흘려넣어 reactive 렌더링.
 * 정렬은 `BuddiesRepository.listAll()` 의 SQL `ORDER BY last_message_at DESC NULLS LAST,
 * created_at DESC` 가 보장한다.
 */
import type { Buddy } from '@/domain/entities/Buddy';

import type { BuddiesUseCaseDeps } from './types';

export function listBuddies(deps: Pick<BuddiesUseCaseDeps, 'buddiesRepo'>): Buddy[] {
  return deps.buddiesRepo.listAll();
}
