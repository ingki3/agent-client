/**
 * S-11 말풍선 (BIZ-266 production 버전).
 *
 * - 사용자/봇/시스템 3 종 layout
 * - 본문은 `Markdown` 컴포넌트로 렌더 (GFM full-spec, FR-15)
 * - 상태 아이콘 5종 + 타임스탬프
 * - 길게 누름 (D-02): 실패한 user 메시지에서만 onLongPress 가 활성화
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Message } from '@/domain/entities/Message';

import { Markdown } from '../markdown';
import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

import { StatusIcon } from './StatusIcon';

interface Props {
  message: Message;
  /** D-02 핸들러 — 실패 / 큐잉 메시지에서만 호출됨. */
  onLongPress?: (message: Message) => void;
}

function formatTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const ChatBubbleV2 = memo(function ChatBubbleV2({ message, onLongPress }: Props) {
  const { color } = useTheme();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const longPressable = isUser && (message.status === 'failed' || message.status === 'queued');

  if (isSystem) {
    return (
      <View style={{ paddingVertical: space[3], alignItems: 'center' }}>
        <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
          {message.text}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        paddingHorizontal: space[4],
        paddingVertical: space[1],
      }}
    >
      <View style={{ maxWidth: '82%' }}>
        <Pressable
          onLongPress={longPressable ? () => onLongPress?.(message) : undefined}
          delayLongPress={350}
          accessibilityRole={longPressable ? 'button' : undefined}
        >
          <View
            style={{
              backgroundColor: color(isUser ? 'user-bubble' : 'agent-bubble'),
              borderRadius: radius.bubble,
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              opacity: message.status === 'sending' || message.status === 'queued' ? 0.85 : 1,
              borderWidth: message.status === 'failed' ? 1 : 0,
              borderColor: color('error'),
            }}
          >
            <Markdown text={message.text} context={isUser ? 'user' : 'agent'} />
          </View>
        </Pressable>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            alignItems: 'center',
            gap: space[1],
            marginTop: 2,
            paddingHorizontal: space[1],
          }}
        >
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize.caption,
            }}
          >
            {formatTime(message.createdAt)}
          </Text>
          {isUser ? <StatusIcon status={message.status} /> : null}
        </View>
      </View>
    </View>
  );
});
