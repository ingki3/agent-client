import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';

import type { Message } from '@/domain/entities/Message';

export function useChatAutoScroll(messages: Message[]) {
  const listRef = useRef<FlashListRef<Message>>(null);
  const scrollRetryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const countRef = useRef(0);
  countRef.current = messages.length;

  const clearTimers = useCallback(() => {
    for (const timer of scrollRetryTimers.current) clearTimeout(timer);
    scrollRetryTimers.current = [];
  }, []);

  const scrollToLatest = useCallback(
    (animated: boolean) => {
      clearTimers();
      // scrollToIndex(last), not scrollToEnd: with variable-height rows,
      // scrollToEnd lands short of the true bottom (it targets the end of
      // already-measured content), leaving the newest messages after a tall
      // message unreachable. scrollToIndex forces measurement up to the item.
      const go = () => {
        const last = countRef.current - 1;
        if (last < 0) return;
        try {
          // viewPosition 1 aligns the last item's bottom to the viewport bottom
          // (the true end of the conversation, even for a tall final message).
          listRef.current?.scrollToIndex({ index: last, animated, viewPosition: 1 });
        } catch {
          listRef.current?.scrollToEnd({ animated });
        }
      };
      requestAnimationFrame(go);
      scrollRetryTimers.current = [
        setTimeout(go, 120),
        setTimeout(go, 350),
        setTimeout(go, 700),
      ];
    },
    [clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length === 0 || messages.length <= prev) return;
    const latest = messages[messages.length - 1];
    if (nearBottomRef.current || latest?.role === 'user') {
      scrollToLatest(true);
    }
  }, [messages, scrollToLatest]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearBottomRef.current = distanceFromBottom < 96;
  }, []);

  return { listRef, scrollToLatest, handleScroll };
}
