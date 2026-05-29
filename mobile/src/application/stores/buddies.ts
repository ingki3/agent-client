/**
 * Buddies store (TECH_SPEC §2.4). Adding a buddy validates the bot token via the real
 * `getMe` (FR-05), stores the token in SecureStore (FR-08), and persists metadata in kv.
 */
import { create } from "zustand";
import type { AccentSlot, Buddy } from "@/domain/entities";
import { botApi, type TgUser } from "@/infrastructure/api/telegramBotApi";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
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
  /** S-12 preview step: validate token and fetch bot metadata. Throws on invalid token. */
  preview: (token: string) => Promise<TgUser>;
  /** S-13 confirm: create the buddy (dedupes by bot id). */
  add: (token: string, meta: TgUser, displayName: string) => Promise<AddResult>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Buddy>) => void;
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
  },

  preview: async (token) => {
    const me = await botApi.getMe(token.trim());
    if (!me.is_bot) throw new Error("봇 토큰이 아닙니다.");
    return me;
  },

  add: async (token, meta, displayName) => {
    const existing = get().buddies.find((b) => b.botId === meta.id);
    if (existing) return { duplicateOf: existing };

    const id = `buddy-${meta.id}`;
    const accent = ACCENTS[get().buddies.length % ACCENTS.length]!;
    const now = new Date().toISOString();
    const buddy: Buddy = {
      id,
      displayName: displayName.trim() || meta.first_name,
      handle: meta.username ? `@${meta.username}` : meta.first_name,
      botId: meta.id,
      chatId: null, // learned from the first incoming update
      live: true,
      supportsTrace: false, // upgraded if the gateway emits trace events
      accent,
      description: "Telegram 호환 봇",
      connected: true,
      unread: 0,
      lastMessagePreview: "",
      lastMessageAt: now,
    };

    await secureStore.set(SecureKeys.botToken(id), token.trim());
    const buddies = [...get().buddies, buddy];
    set({ buddies });
    await persist(buddies);
    return { id };
  },

  remove: async (id) => {
    await secureStore.remove(SecureKeys.botToken(id));
    await kv.remove(KvKeys.messages(id));
    const buddies = get().buddies.filter((b) => b.id !== id);
    set({ buddies });
    await persist(buddies);
  },

  update: (id, patch) => {
    const buddies = get().buddies.map((b) => (b.id === id ? { ...b, ...patch } : b));
    set({ buddies });
    void persist(buddies);
  },

  reset: async () => {
    for (const b of get().buddies) {
      await secureStore.remove(SecureKeys.botToken(b.id));
      await kv.remove(KvKeys.messages(b.id));
    }
    await kv.remove(KvKeys.buddies);
    set({ buddies: [], hydrated: false });
  },
}));
