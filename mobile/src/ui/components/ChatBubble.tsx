import { View, Text } from 'react-native';

import type { Message } from '@/lib/mock/fixtures';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

const STATUS_LABEL: Record<NonNullable<Message['status']>, string> = {
  sending: '보내는 중',
  sent: '보냄',
  delivered: '전달됨',
  failed: '실패',
  'queued-offline': '오프라인 대기',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function ChatBubble({ message }: { message: Message }) {
  const { color } = useTheme();
  const isUser = message.author === 'user';
  const isSystem = message.author === 'system';

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
      <View style={{ maxWidth: '78%' }}>
        <View
          style={{
            backgroundColor: color(isUser ? 'user-bubble' : 'agent-bubble'),
            borderRadius: radius.bubble,
            paddingHorizontal: space[4],
            paddingVertical: space[3],
            borderBottomRightRadius: isUser ? radius.sm : radius.bubble,
            borderBottomLeftRadius: isUser ? radius.bubble : radius.sm,
          }}
        >
          <Text
            style={{
              color: color(isUser ? 'on-user-bubble' : 'on-agent-bubble'),
              fontSize: fontSize.body,
              lineHeight: fontSize.body * 1.45,
            }}
            selectable
          >
            {message.text}
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            gap: space[2],
            marginTop: space[1],
            paddingHorizontal: space[1],
          }}
        >
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
            {formatTime(message.createdAt)}
          </Text>
          {message.status ? (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              · {STATUS_LABEL[message.status]}
            </Text>
          ) : null}
        </View>

        {message.traceSummary ? (
          <View
            style={{
              marginTop: space[2],
              backgroundColor: color('trace-summary'),
              borderRadius: radius.lg,
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              alignSelf: isUser ? 'flex-end' : 'flex-start',
            }}
          >
            <Text
              style={{
                color: color('on-trace-summary'),
                fontSize: fontSize.caption,
                fontWeight: '600',
              }}
            >
              🧠 {message.traceSummary.thinkingSteps}단계 · 🛠 {message.traceSummary.toolCalls}개 툴
              · ⏱ {(message.traceSummary.elapsedMs / 1000).toFixed(1)}초
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
