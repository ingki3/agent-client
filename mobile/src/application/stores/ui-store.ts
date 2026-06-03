import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

interface UIState {
  toasts: Toast[];
  /** 라우팅 보조 — modal/sheet 표시 의도. UI layer 가 소비. */
  pendingRouteIntent: string | null;
  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  setRouteIntent: (intent: string | null) => void;
}

function randomId(): string {
  return `t-${Math.random().toString(36).slice(2, 10)}`;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  pendingRouteIntent: null,
  pushToast: (toast) => {
    const id = randomId();
    set((s) => ({ toasts: [...s.toasts, { id, ...toast }] }));
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setRouteIntent: (intent) => set({ pendingRouteIntent: intent }),
}));
