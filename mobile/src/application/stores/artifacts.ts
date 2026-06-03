import { create } from "zustand";
import type { AgentArtifact } from "@/domain/entities";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { useTasksStore } from "./tasks";
import { seedArtifacts } from "@/mock/seed";

type ArtifactsState = {
  byBuddy: Record<string, AgentArtifact[]>;
  hydrate: (buddyId: string) => Promise<void>;
  upsertFromPayload: (
    buddyId: string,
    artifact: Omit<AgentArtifact, "buddyId" | "sourceMessageId" | "createdAt"> & Partial<Pick<AgentArtifact, "createdAt">>,
    sourceMessageId?: string,
  ) => void;
  clear: () => void;
};

export const useArtifactsStore = create<ArtifactsState>((set, get) => {
  const persist = (buddyId: string) => {
    void kv.set(KvKeys.artifacts(buddyId), get().byBuddy[buddyId] ?? []);
  };

  return {
    byBuddy: {},

    hydrate: async (buddyId) => {
      if (get().byBuddy[buddyId]) return;
      const stored = await kv.get<AgentArtifact[]>(KvKeys.artifacts(buddyId));
      const initial = stored ?? seedArtifacts[buddyId] ?? [];
      set((s) => ({ byBuddy: { ...s.byBuddy, [buddyId]: initial } }));
      if (!stored && seedArtifacts[buddyId]) persist(buddyId);
    },

    upsertFromPayload: (buddyId, artifact, sourceMessageId) => {
      const item: AgentArtifact = {
        ...artifact,
        buddyId,
        sourceMessageId,
        createdAt: artifact.createdAt ?? new Date().toISOString(),
      };
      set((s) => {
        const list = s.byBuddy[buddyId] ?? [];
        const existing = list.some((a) => a.id === item.id);
        return {
          byBuddy: {
            ...s.byBuddy,
            [buddyId]: existing ? list.map((a) => (a.id === item.id ? { ...a, ...item } : a)) : [...list, item],
          },
        };
      });
      if (item.taskId) useTasksStore.getState().linkArtifact(buddyId, item.taskId, item.id);
      persist(buddyId);
    },

    clear: () => set({ byBuddy: {} }),
  };
});
