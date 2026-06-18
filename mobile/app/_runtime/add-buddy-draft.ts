/**
 * Module-level draft for the S-12 → S-13 hand-off.
 *
 * Why not route params: the token is a high-sensitivity secret. Stashing it in
 * `expo-router` route state risks leaking via deep-link history / typed-route
 * serialization. The draft lives in memory only; navigating away from the flow
 * (or finishing it) clears it.
 */
import type { BotIdentity } from '@/domain/value-objects/BotIdentity';

export interface AddBuddyDraft {
  token: string;
  identity: BotIdentity;
  /** S-13 displayName seed — `username` if present, else `first_name`. */
  defaultDisplayName: string;
}

let current: AddBuddyDraft | null = null;

export function setAddBuddyDraft(draft: AddBuddyDraft): void {
  current = draft;
}

export function readAddBuddyDraft(): AddBuddyDraft | null {
  return current;
}

export function clearAddBuddyDraft(): void {
  current = null;
}
