/** Transient draft shared between S-12 (username) and S-13 (preview). */
import { create } from "zustand";
import type { ResolvedPeer } from "@/infrastructure/api/relayClient";

type DraftState = {
  peer: ResolvedPeer | null;
  set: (peer: ResolvedPeer) => void;
  clear: () => void;
};

export const useAddBuddyDraft = create<DraftState>((set) => ({
  peer: null,
  set: (peer) => set({ peer }),
  clear: () => set({ peer: null }),
}));
