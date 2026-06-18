import { create } from "zustand";
import type { AgentTask, TaskStatus } from "@/domain/entities";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { seedTasks } from "@/mock/seed";

type TasksState = {
  byBuddy: Record<string, AgentTask[]>;
  hydrate: (buddyId: string) => Promise<void>;
  upsertFromPayload: (
    buddyId: string,
    task: Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "status">,
    sourceMessageId?: string,
  ) => void;
  setStatus: (buddyId: string, taskId: string, status: TaskStatus) => void;
  linkArtifact: (buddyId: string, taskId: string, artifactId: string) => void;
  clear: () => void;
};

function nowIso() {
  return new Date().toISOString();
}

export const useTasksStore = create<TasksState>((set, get) => {
  const persist = (buddyId: string) => {
    void kv.set(KvKeys.tasks(buddyId), get().byBuddy[buddyId] ?? []);
  };

  return {
    byBuddy: {},

    hydrate: async (buddyId) => {
      if (get().byBuddy[buddyId]) return;
      const stored = await kv.get<AgentTask[]>(KvKeys.tasks(buddyId));
      const initial = stored ?? seedTasks[buddyId] ?? [];
      set((s) => ({ byBuddy: { ...s.byBuddy, [buddyId]: initial } }));
      if (!stored && seedTasks[buddyId]) persist(buddyId);
    },

    upsertFromPayload: (buddyId, task, sourceMessageId) => {
      const ts = nowIso();
      set((s) => {
        const list = s.byBuddy[buddyId] ?? [];
        const existing = list.find((t) => t.id === task.id);
	        const next: AgentTask = {
	          id: task.id,
	          buddyId,
	          title: task.title,
	          status: task.status,
	          createdAt: task.createdAt ?? existing?.createdAt ?? ts,
	          updatedAt: task.updatedAt ?? ts,
	          artifactIds: task.artifactIds ?? existing?.artifactIds ?? [],
	        };
	        const nextSourceMessageId = sourceMessageId ?? task.sourceMessageId ?? existing?.sourceMessageId;
	        if (nextSourceMessageId !== undefined) next.sourceMessageId = nextSourceMessageId;
        const merged = existing ? list.map((t) => (t.id === task.id ? { ...existing, ...next } : t)) : [...list, next];
        return { byBuddy: { ...s.byBuddy, [buddyId]: merged } };
      });
      persist(buddyId);
    },

    setStatus: (buddyId, taskId, status) => {
      set((s) => ({
        byBuddy: {
          ...s.byBuddy,
          [buddyId]: (s.byBuddy[buddyId] ?? []).map((t) =>
            t.id === taskId ? { ...t, status, updatedAt: nowIso() } : t,
          ),
        },
      }));
      persist(buddyId);
    },

    linkArtifact: (buddyId, taskId, artifactId) => {
      set((s) => ({
        byBuddy: {
          ...s.byBuddy,
          [buddyId]: (s.byBuddy[buddyId] ?? []).map((t) =>
            t.id === taskId && !t.artifactIds.includes(artifactId)
              ? { ...t, artifactIds: [...t.artifactIds, artifactId], updatedAt: nowIso() }
              : t,
          ),
        },
      }));
      persist(buddyId);
    },

    clear: () => set({ byBuddy: {} }),
  };
});
