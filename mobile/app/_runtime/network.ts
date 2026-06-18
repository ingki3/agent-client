/**
 * Network composition root — wires `@react-native-community/netinfo` to
 * `useNetworkStore` and triggers automatic `outbox` re-send when we come back
 * online (TECH §3.4).
 *
 * Lifecycle:
 *   - `initNetworkRuntime()` (called from `app/_layout.tsx`) starts the NetInfo
 *     subscription once. On every transition, the store is updated and, if
 *     we just came online, a single `flushOutboxFlow()` pass is kicked off
 *     with exponential backoff between iterations.
 */
import { createNetworkMonitor } from '@/infrastructure/platform/network-monitor';
import { useNetworkStore } from '@/application/stores/network-store';

import { flushOutboxFlow, refreshPendingOutboxCount } from './chat';

let started = false;
let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushIteration = 0;
const MAX_BACKGROUND_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

export function initNetworkRuntime(): void {
  if (started) return;
  started = true;
  const monitor = createNetworkMonitor();
  let lastOnline = useNetworkStore.getState().isOnline;
  refreshPendingOutboxCount();
  unsubscribe = monitor.start((isOnline) => {
    useNetworkStore.getState().setOnline(isOnline);
    const justCameOnline = isOnline && !lastOnline;
    lastOnline = isOnline;
    if (justCameOnline) {
      flushIteration = 0;
      scheduleFlush(0);
    }
    if (!isOnline) {
      cancelFlush();
    }
  });
}

function scheduleFlush(delayMs: number): void {
  cancelFlush();
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      await flushOutboxFlow();
    } catch {
      // ignore — refreshPendingOutboxCount inside flushOutboxFlow still ran for
      // the partial result; we just don't requeue.
    }
    flushIteration += 1;
    const remaining = useNetworkStore.getState().pendingOutboxCount;
    if (remaining > 0 && flushIteration < MAX_BACKGROUND_RETRIES && useNetworkStore.getState().isOnline) {
      scheduleFlush(BASE_BACKOFF_MS * Math.pow(2, flushIteration));
    }
  }, delayMs);
}

function cancelFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function _resetNetworkRuntime(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  started = false;
  cancelFlush();
  flushIteration = 0;
}
