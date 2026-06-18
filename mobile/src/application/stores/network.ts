/**
 * Network store — TECH §2.4 / §3.4. Online/offline status and the count of
 * messages waiting in the SQLite outbox.
 *
 * Foundation (BIZ-268) ships the empty slice. The NetInfo subscription +
 * outbox accounting land with M1 sub 5 (BIZ-274) — the slice surface stays
 * stable so use-cases can reference it from sub 3 onward.
 */
import { create } from 'zustand';

type NetworkState = {
  online: boolean;
  pendingOutbox: number;
};

export const useNetworkStore = create<NetworkState>(() => ({
  online: true,
  pendingOutbox: 0,
}));
