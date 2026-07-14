import { useCallback, useEffect, useRef } from 'react';
import type { FlashListRef } from '@shopify/flash-list';

import type { Message } from '@/domain/entities/Message';

/**
 * Explicit scroll-to-bottom for the chat list.
 *
 * Staying pinned to the bottom is now the list's own job: the FlashList v2
 * `maintainVisibleContentPosition` config (startRenderingFromBottom +
 * autoscrollToBottomThreshold) renders the room bottom-anchored on entry and
 * keeps it stuck while new content arrives or bubbles grow (late-loading
 * link-preview/attachment images). This hook only covers the two cases the
 * native anchor intentionally does not:
 *   - the user sends a message while scrolled up (a chat app snaps back down)
 *   - the Android keyboard opens (only the bottom padding changes, which the
 *     native bound-check never sees — the screen calls scrollToLatest itself)
 */
export function useChatAutoScroll(messages: Message[]) {
  const listRef = useRef<FlashListRef<Message>>(null);
  const prevMessageCountRef = useRef(0);

  const scrollToLatest = useCallback((animated: boolean) => {
    // v2 scrollToEnd measures the last item before scrolling and targets the
    // true content end INCLUDING contentContainer bottom padding — unlike
    // scrollToIndex(viewPosition: 1), which ignores the padding and parks the
    // last bubble behind the absolute-positioned composer.
    requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length === 0 || messages.length <= prev) return;
    // Own send → always return to the bottom, even from far up the history.
    // Agent arrivals near the bottom are handled by the native autoscroll.
    if (messages[messages.length - 1]?.role === 'user') {
      scrollToLatest(true);
    }
  }, [messages, scrollToLatest]);

  return { listRef, scrollToLatest };
}
