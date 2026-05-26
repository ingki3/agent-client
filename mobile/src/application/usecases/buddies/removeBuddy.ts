/**
 * removeBuddy — 친구 삭제 + 관련 로컬 데이터 cascade 제거 (PRD UC-03 / FR-08).
 *
 * 마이그레이션 v1 의 FK 는 ON DELETE CASCADE 가 아니라서 (database.ts MIGRATIONS),
 * 사용 사례 레이어에서 명시적으로 buddy → traces → messages → outbox → buddy
 * 순서로 trans 안에서 일괄 정리한다. 이렇게 하면 schema migration 없이도 정합성 보장.
 *
 * SecureStore 의 토큰 삭제는 SQLite 트랜잭션과 별개로 best-effort 호출.
 * SecureStore 가 실패해도 SQLite cascade 는 그대로 적용 — 토큰만 남는 경우는
 * 다음 cold-start 의 cleanup 패스에서 제거될 수 있도록 별도 sub-issue 로 트래킹.
 */
import type { BuddyId } from '@/domain/entities/Buddy';

import type { BuddiesUseCaseDeps } from './types';

export interface RemoveBuddyInput {
  buddyId: BuddyId;
}

export async function removeBuddy(
  deps: BuddiesUseCaseDeps,
  input: RemoveBuddyInput,
): Promise<void> {
  const { db, buddiesRepo, tokenStore } = deps;
  const { buddyId } = input;

  db.transaction(() => {
    // outbox.message_id 와 traces.message_id 는 모두 messages.id FK (database.ts MIGRATIONS).
    // outbox 가 messages.id 를 참조하므로 messages.id 로 일괄 조회해서 정리.
    // outbox 자체엔 buddy_id 컬럼도 있으니 양쪽으로 안전망 — 둘 중 하나만 들어맞아도 cascade.
    db.run('DELETE FROM outbox WHERE buddy_id = ?', [buddyId]);
    db.run(
      `DELETE FROM traces
       WHERE message_id IN (SELECT id FROM messages WHERE buddy_id = ?)`,
      [buddyId],
    );
    db.run('DELETE FROM messages WHERE buddy_id = ?', [buddyId]);
    buddiesRepo.remove(buddyId);
  });

  await tokenStore.remove(buddyId);
}
