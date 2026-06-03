/**
 * Buddies composition root — wires BuddiesUseCaseDeps to the concrete runtime
 * adapters and exposes high-level flow helpers for the (main)/buddies screens.
 *
 * Lives under `app/` (not `src/application`) because the layer rule (TECH §2.3)
 * forbids the application layer from importing infrastructure directly.
 * The composition root is the only place that may know about both sides.
 */
import { useBuddiesStore } from '@/application/stores/buddies-store';
import {
  addBuddy as addBuddyUseCase,
  type AddBuddyResult,
  type BuddiesUseCaseDeps,
  DuplicateBuddyError,
  listBuddies as listBuddiesUseCase,
  removeBuddy as removeBuddyUseCase,
} from '@/application/usecases/buddies';
import type { Buddy, BuddyId } from '@/domain/entities/Buddy';
import { BotApiClient } from '@/infrastructure/api/bot-api-client';
import { createExpoSqliteDatabase } from '@/infrastructure/storage/adapters/expo-sqlite-adapter';
import { botTokenStore } from '@/infrastructure/storage/bot-token-store';
import { applyMigrations, type Database } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';

const DEFAULT_GATEWAY = 'https://api.telegram.org';
const SQLITE_FILENAME = 'agentclient.db';

let initialized = false;
let depsRef: BuddiesUseCaseDeps | null = null;

function getDeps(): BuddiesUseCaseDeps {
  if (!depsRef) {
    throw new Error('Buddies runtime not initialized — call initBuddiesRuntime() first.');
  }
  return depsRef;
}

/**
 * Idempotent cold-start wiring. Safe to call from every entry screen's
 * useEffect — the database open + migration + store hydrate run only once.
 */
export function initBuddiesRuntime(): void {
  if (initialized) return;
  initialized = true;

  const db: Database = createExpoSqliteDatabase(SQLITE_FILENAME);
  applyMigrations(db);
  const buddiesRepo = new BuddiesRepository(db);
  const botApi = new BotApiClient({ gateway: DEFAULT_GATEWAY });

  depsRef = { db, buddiesRepo, tokenStore: botTokenStore, botApi };

  refreshBuddies();
}

/** S-10 entry / pull-to-refresh / post-mutation re-sync. */
export function refreshBuddies(): Buddy[] {
  const list = listBuddiesUseCase({ buddiesRepo: getDeps().buddiesRepo });
  useBuddiesStore.getState().setAll(list);
  return list;
}

export async function addBuddyFlow(input: {
  token: string;
  displayName?: string;
}): Promise<AddBuddyResult> {
  const deps = getDeps();
  const result = await addBuddyUseCase(deps, input);
  useBuddiesStore.getState().upsert(result.buddy);
  return result;
}

export async function removeBuddyFlow(buddyId: BuddyId): Promise<void> {
  const deps = getDeps();
  await removeBuddyUseCase(deps, { buddyId });
  useBuddiesStore.getState().remove(buddyId);
}

/** S-12 → S-13: validate token without persisting. Surfaces BotApiError verbatim. */
export async function previewBuddyFromToken(token: string): Promise<{
  identity: ReturnType<typeof toIdentity>;
  duplicateOf?: Buddy;
}> {
  const deps = getDeps();
  const tgUser = await deps.botApi.getMe(token);
  const identity = toIdentity(tgUser);
  const duplicate = deps.buddiesRepo.findById(identity.id);
  return duplicate ? { identity, duplicateOf: duplicate } : { identity };
}

function toIdentity(user: {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}) {
  return {
    id: String(user.id),
    isBot: user.is_bot,
    firstName: user.first_name,
    username: user.username ?? null,
  };
}

export { DuplicateBuddyError };
