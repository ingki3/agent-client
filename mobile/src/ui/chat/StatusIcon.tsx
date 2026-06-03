/**
 * Per-message status indicator (S-11 말풍선 모서리, USER_FLOW D-02).
 *
 * 5종 상태 (PRD §5.1):
 *   - sending   : 회색 시계
 *   - sent      : 단일 체크
 *   - delivered : 더블 체크 (Telegram 호환 의미)
 *   - failed    : 빨간 ! (D-02 길게 누름 menu trigger)
 *   - queued    : 회색 다운로드 (오프라인 대기, D-06 배너와 함께)
 */
import { Text, View } from 'react-native';

import type { MessageStatus } from '@/domain/entities/Message';

import { useTheme } from '../theme/ThemeProvider';
import { fontSize } from '../theme/tokens';

interface Props {
  status: MessageStatus;
  /** Renders white-on-blue glyphs when sitting on a user bubble. */
  onUserBubble?: boolean;
}

export function StatusIcon({ status, onUserBubble = false }: Props) {
  const { color } = useTheme();

  const colorFor = (token: Parameters<typeof color>[0], userOverride?: Parameters<typeof color>[0]) =>
    onUserBubble && userOverride ? color(userOverride) : color(token);

  const styleBase = {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption + 2,
    fontWeight: '700' as const,
  };

  switch (status) {
    case 'sending':
      return (
        <Text
          accessibilityLabel="보내는 중"
          style={[styleBase, { color: colorFor('text-secondary', 'on-user-bubble') }]}
        >
          ◔
        </Text>
      );
    case 'sent':
      return (
        <Text
          accessibilityLabel="전송됨"
          style={[styleBase, { color: colorFor('success', 'on-user-bubble') }]}
        >
          ✓
        </Text>
      );
    case 'delivered':
      return (
        <Text
          accessibilityLabel="전달됨"
          style={[styleBase, { color: colorFor('success', 'on-user-bubble') }]}
        >
          ✓✓
        </Text>
      );
    case 'failed':
      return (
        <View
          accessibilityLabel="송신 실패 — 다시 보내려면 길게 누르세요"
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color('error'),
          }}
        >
          <Text style={{ color: color('text-inverse'), fontSize: 9, fontWeight: '900', lineHeight: 11 }}>
            !
          </Text>
        </View>
      );
    case 'queued':
      return (
        <Text
          accessibilityLabel="오프라인 대기"
          style={[styleBase, { color: colorFor('offline', 'on-user-bubble') }]}
        >
          ⇣
        </Text>
      );
  }
}
