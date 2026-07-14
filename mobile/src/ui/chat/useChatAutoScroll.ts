import { useCallback, useEffect, useRef } from 'react';
import type { FlashListRef } from '@shopify/flash-list';

import type { BuddyId } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';

/**
 * Scroll orchestration for the chat list, layered on FlashList v2's native
 * chat anchor (`maintainVisibleContentPosition`): startRenderingFromBottom
 * paints the room bottom-anchored on entry, and autoscrollToBottomThreshold
 * keeps it pinned while new content arrives or bubbles grow. This hook covers
 * what the native anchor leaves out:
 *
 * - Entry settle: for a last message TALLER than the viewport, the native
 *   initial scroll parks at the message's TOP (it targets the item's y and
 *   re-asserts it for ~100ms after the first data layout), not the
 *   conversation end. `handleListLoad` (wired to FlashList onLoad — the
 *   library's "first layout complete" signal) runs a short scrollToEnd
 *   sequence that outlasts that window; a user drag cancels it so we never
 *   yank someone who already started reading.
 * - Room retarget: a push-tap can point the mounted screen at another buddy
 *   (router.navigate updates params in place) — onLoad never re-fires, so the
 *   buddyId effect re-runs the entry settle.
 * - Own send: the user sends while scrolled up → snap back down.
 * - Android keyboard: only the bottom padding changes, which the native
 *   bound-check never sees — the screen calls scrollToLatest itself.
 */
export function useChatAutoScroll(messages: Message[], buddyId: BuddyId | undefined) {
  const listRef = useRef<FlashListRef<Message>>(null);
  const prevMessageCountRef = useRef(0);
  const entryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearEntryTimers = useCallback(() => {
    for (const timer of entryTimersRef.current) clearTimeout(timer);
    entryTimersRef.current = [];
  }, []);

  const scrollToLatest = useCallback((animated: boolean) => {
    // v2 scrollToEnd measures the last item before scrolling and targets the
    // true content end INCLUDING contentContainer bottom padding — unlike
    // scrollToIndex(viewPosition: 1), which ignores the padding and parks the
    // last bubble behind the absolute-positioned composer.
    requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  /**
   * Settle at the true conversation end. Repeated shots because the native
   * initial scroll re-asserts the last item's top for ~100ms after the first
   * data layout, and entry-time JS congestion (hydrate + backfill + render)
   * delays timers unpredictably — the last shot to run wins, and once at the
   * bottom the extra shots are visual no-ops (same target offset).
   */
  const runEntrySettle = useCallback(() => {
    clearEntryTimers();
    scrollToLatest(false);
    entryTimersRef.current = [300, 900].map((ms) =>
      setTimeout(() => scrollToLatest(false), ms),
    );
  }, [clearEntryTimers, scrollToLatest]);

  /** Wire to FlashList onLoad — fires once when the first layout completes. */
  const handleListLoad = useCallback(() => {
    runEntrySettle();
  }, [runEntrySettle]);

  /** Wire to onScrollBeginDrag — the user took over; stop auto-settling. */
  const handleScrollBeginDrag = useCallback(() => {
    clearEntryTimers();
  }, [clearEntryTimers]);

  // Retarget (buddyId change on a mounted screen): reset the count baseline and
  // re-settle. On first mount this fires before the list has data — harmless
  // no-ops; the onLoad path owns the mount-time settle.
  useEffect(() => {
    prevMessageCountRef.current = 0;
    runEntrySettle();
    return clearEntryTimers;
  }, [buddyId, runEntrySettle, clearEntryTimers]);

  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length === 0 || messages.length <= prev || prev === 0) return;
    // Own send → always return to the bottom, even from far up the history.
    // Agent arrivals near the bottom are handled by the native autoscroll.
    if (messages[messages.length - 1]?.role === 'user') {
      scrollToLatest(true);
    }
  }, [messages, scrollToLatest]);

  return { listRef, scrollToLatest, handleListLoad, handleScrollBeginDrag };
}
