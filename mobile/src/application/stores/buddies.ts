/**
 * Buddies store (TECH_SPEC §2.4). A live buddy is a Telegram **peer** (a bot/chat the user
 * talks to), resolved by @username through the relay's user-account (MTProto) session. No
 * per-buddy secret lives on the device — the relay holds the user's session and sends as
 * the user. Metadata is persisted in kv.
 */
import { create } from "zustand";
import type { AccentSlot, Buddy } from "@/domain/entities";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { pushEnabled } from "@/infrastructure/config";
import { relayClient, type ResolvedPeer } from "@/infrastructure/api/relayClient";
import { seedBuddies } from "@/mock/seed";

const ACCENTS: AccentSlot[] = [
  "accent-buddy-1",
  "accent-buddy-2",
  "accent-buddy-3",
  "accent-buddy-4",
  "accent-buddy-5",
  "accent-buddy-6",
  "accent-buddy-7",
  "accent-buddy-8",
];

type AddResult = { id: string } | { duplicateOf: Buddy };

type BuddiesState = {
  buddies: Buddy[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** S-12 preview step: resolve a @username to a peer via the relay. Throws on failure. */
  preview: (username: string) => Promise<ResolvedPeer>;
  /** S-13 confirm: create the buddy (dedupes by peer id). */
  add: (peer: ResolvedPeer, displayName: string) => Promise<AddResult>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Buddy>) => void;
  /** Clear a buddy's unread badge (called when its chat is viewed). */
  markRead: (id: string) => void;
  reset: () => Promise<void>;
};

async function persist(buddies: Buddy[]) {
  await kv.set(KvKeys.buddies, buddies);
}

export const useBuddiesStore = create<BuddiesState>((set, get) => ({
  buddies: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = await kv.get<Buddy[]>(KvKeys.buddies);
    if (stored && stored.length > 0) {
      set({ buddies: stored, hydrated: true });
    } else {
      set({ buddies: seedBuddies, hydrated: true });
      await persist(seedBuddies);
    }
    // Self-heal: re-register live peers with the relay now that buddies are loaded
    // (idempotent). Guarantees the device + subscriptions exist so relay-pull receive
    // works even if the relay previously dropped the device.
    if (pushEnabled) {
      const live = get().buddies.filter((b): b is Buddy & { botId: number } => b.live && b.botId != null);
      if (live.length) {
        const pushTok = (await secureStore.get(SecureKeys.expoPushToken)) ?? "";
        void relayClient.register(pushTok, live.map((b) => ({ buddyId: b.id, botId: b.botId })));
      }
    }
  },

  preview: async (username) => {
    return relayClient.resolvePeer(username.trim());
  },

  add: async (peer, displayName) => {
    const existing = get().buddies.find((b) => b.botId === peer.peerId);
    if (existing) return { duplicateOf: existing };

    const id = `buddy-${peer.peerId}`;
    const accent = ACCENTS[get().buddies.length % ACCENTS.length]!;
    const now = new Date().toISOString();
    const buddy: Buddy = {
      id,
      displayName: displayName.trim() || peer.title,
      handle: `@${peer.username}`,
      botId: peer.peerId,
      username: peer.username,
      chatId: peer.peerId, // a private chat's id equals the peer's user id
      live: true,
      supportsTrace: false,
      accent,
      description: "Telegram 사용자/봇",
      connected: true,
      unread: 0,
      lastMessagePreview: "",
      lastMessageAt: now,
    };

    const buddies = [...get().buddies, buddy];
    set({ buddies });
    await persist(buddies);

    // Record the subscription with the relay (no token — the relay's user session receives
    // for this peer). Register even without a push token so the relay-pull path works.
    if (pushEnabled) {
      const pushTok = (await secureStore.get(SecureKeys.expoPushToken)) ?? "";
      void relayClient.register(pushTok, [{ buddyId: id, botId: peer.peerId }]);
    }
    return { id };
  },

  remove: async (id) => {
    const buddy = get().buddies.find((b) => b.id === id);
    if (pushEnabled && buddy?.botId != null) await relayClient.unregister(buddy.botId);
    await kv.remove(KvKeys.messages(id));
    await kv.remove(KvKeys.offset(id));
    const buddies = get().buddies.filter((b) => b.id !== id);
    set({ buddies });
    await persist(buddies);
  },

  update: (id, patch) => {
    const buddies = get().buddies.map((b) => (b.id === id ? { ...b, ...patch } : b));
    set({ buddies });
    void persist(buddies);
  },

  markRead: (id) => {
    const b = get().buddies.find((x) => x.id === id);
    if (b && b.unread > 0) get().update(id, { unread: 0 });
  },

  reset: async () => {
    if (pushEnabled) await relayClient.unregister(); // drop whole device from relay
    for (const b of get().buddies) {
      await kv.remove(KvKeys.messages(b.id));
      await kv.remove(KvKeys.offset(b.id));
    }
    await kv.remove(KvKeys.buddies);
    set({ buddies: [], hydrated: false });
  },
}));
