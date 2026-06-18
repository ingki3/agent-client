import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';

import type { Message } from '@/domain/entities/Message';

export function useChatAutoScroll(messages: Message[]) {
  const listRef = useRef<FlashListRef<Message>>(null);
  const scrollRetryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const clearTimers = useCallback(() => {
    for (const timer of scrollRetryTimers.current) clearTimeout(timer);
    scrollRetryTimers.current = [];
  }, []);

  const scrollToLatest = useCallback(
    (animated: boolean) => {
      clearTimers();
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated });
        scrollRetryTimers.current = [
          setTimeout(() => listRef.current?.scrollToEnd({ animated }), 80),
          setTimeout(() => listRef.current?.scrollToEnd({ animated }), 240),
        ];
      });
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
