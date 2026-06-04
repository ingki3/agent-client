import { create } from "zustand";
import type { AgentForm, FormValue } from "@/domain/entities";
import { kv, KvKeys } from "@/infrastructure/storage/kv";
import { relayClient } from "@/infrastructure/api/relayClient";
import { useBuddiesStore } from "./buddies";
import { seedForms } from "@/mock/seed";

type FormsState = {
  byBuddy: Record<string, AgentForm[]>;
  hydrate: (buddyId: string) => Promise<void>;
  upsertFromPayload: (
    buddyId: string,
    form: Omit<AgentForm, "buddyId" | "sourceMessageId" | "createdAt" | "status"> &
      Partial<Pick<AgentForm, "createdAt" | "status">>,
    sourceMessageId?: string,
  ) => void;
  submit: (buddyId: string, formId: string, values: Record<string, FormValue>) => Promise<boolean>;
  cancel: (buddyId: string, formId: string) => Promise<boolean>;
  clear: () => void;
};

export const useFormsStore = create<FormsState>((set, get) => {
  const persist = (buddyId: string) => {
    void kv.set(KvKeys.forms(buddyId), get().byBuddy[buddyId] ?? []);
  };

  const patch = (buddyId: string, formId: string, patchForm: Partial<AgentForm>) => {
    set((s) => ({
      byBuddy: {
        ...s.byBuddy,
        [buddyId]: (s.byBuddy[buddyId] ?? []).map((f) => (f.id === formId ? { ...f, ...patchForm } : f)),
      },
    }));
    persist(buddyId);
  };

  return {
    byBuddy: {},

    hydrate: async (buddyId) => {
      if (get().byBuddy[buddyId]) return;
      const stored = await kv.get<AgentForm[]>(KvKeys.forms(buddyId));
      const initial = stored ?? seedForms[buddyId] ?? [];
      set((s) => ({ byBuddy: { ...s.byBuddy, [buddyId]: initial } }));
      if (!stored && seedForms[buddyId]) persist(buddyId);
    },

	    upsertFromPayload: (buddyId, form, sourceMessageId) => {
	      const item: AgentForm = {
	        ...form,
	        buddyId,
	        status: form.status ?? "pending",
	        createdAt: form.createdAt ?? new Date().toISOString(),
	      };
	      if (sourceMessageId !== undefined) item.sourceMessageId = sourceMessageId;
      set((s) => {
        const list = s.byBuddy[buddyId] ?? [];
        const existing = list.some((f) => f.id === item.id);
        return {
          byBuddy: {
            ...s.byBuddy,
            [buddyId]: existing ? list.map((f) => (f.id === item.id ? { ...f, ...item } : f)) : [...list, item],
          },
        };
      });
      persist(buddyId);
    },

    submit: async (buddyId, formId, values) => {
      const form = get().byBuddy[buddyId]?.find((f) => f.id === formId);
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (!form || !buddy?.botId) return false;
	      const payload: { formId: string; taskId?: string; status: "submitted"; values: Record<string, FormValue> } = {
	        formId,
	        status: "submitted",
	        values,
	      };
	      if (form.taskId !== undefined) payload.taskId = form.taskId;
	      const ok = await relayClient.submitForm(buddy.botId, payload);
      if (ok) patch(buddyId, formId, { status: "submitted", values, submittedAt: new Date().toISOString() });
      return ok;
    },

    cancel: async (buddyId, formId) => {
      const form = get().byBuddy[buddyId]?.find((f) => f.id === formId);
      const buddy = useBuddiesStore.getState().buddies.find((b) => b.id === buddyId);
      if (!form || !buddy?.botId) return false;
	      const payload: { formId: string; taskId?: string; status: "cancelled"; values: Record<string, FormValue> } = {
	        formId,
	        status: "cancelled",
	        values: {},
	      };
	      if (form.taskId !== undefined) payload.taskId = form.taskId;
	      const ok = await relayClient.submitForm(buddy.botId, payload);
      if (ok) patch(buddyId, formId, { status: "cancelled", submittedAt: new Date().toISOString() });
      return ok;
    },

    clear: () => set({ byBuddy: {} }),
  };
});
