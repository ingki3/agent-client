/** Transient draft shared between S-12 (token) and S-13 (preview). */
import { create } from "zustand";
import type { TgUser } from "@/infrastructure/api/telegramBotApi";

type DraftState = {
  token: string | null;
  meta: TgUser | null;
  set: (token: string, meta: TgUser) => void;
  clear: () => void;
};

export const useAddBuddyDraft = create<DraftState>((set) => ({
  token: null,
  meta: null,
  set: (token, meta) => set({ token, meta }),
  clear: () => set({ token: null, meta: null }),
}));
