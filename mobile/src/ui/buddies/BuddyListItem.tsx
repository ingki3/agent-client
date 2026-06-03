/**
 * S-10 row — renders a real `Buddy` (domain entity) rather than the legacy
 * mock fixture shape. Surface mirrors USER_FLOW §S-10: avatar, display name,
 * preview, relative timestamp, unread badge, connection dot.
 */
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Buddy } from '@/domain/entities/Buddy';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(epochMs: number | null, nowMs: number): string {
  if (!epochMs) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < MINUTE) return '방금';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}시간 전`;
  return `${Math.round(diff / DAY)}일 전`;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = trimmed[0] ?? '?';
  return first.toUpperCase();
}

export function BuddyListItem({
  buddy,
  online,
  onPress,
  onLongPress,
}: {
  buddy: Buddy;
  online: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { color } = useTheme();
  const subtitle = useMemo(
    () => buddy.lastMessagePreview ?? (buddy.username ? `@${buddy.username}` : '새 친구입니다'),
    [buddy.lastMessagePreview, buddy.username],
  );
  const timestamp = formatRelative(buddy.lastMessageAt, Date.now());

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${buddy.displayName} 채팅 열기`}
      accessibilityHint="길게 눌러 빠른 액션 열기"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        backgroundColor: pressed ? color('surface-elevated') : color('surface'),
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.full,
          backgroundColor: color('surface-elevated'),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: color('text-primary'),
            fontSize: fontSize['title-sm'],
            fontWeight: '700',
          }}
        >
          {initials(buddy.displayName)}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: space[2],
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-sm'],
              fontWeight: '600',
              flexShrink: 1,
            }}
          >
            {buddy.displayName}
          </Text>
          {timestamp ? (
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
              {timestamp}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: space[2],
            marginTop: space[1],
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: color('text-secondary'),
              fontSize: fontSize['body-sm'],
              flexShrink: 1,
            }}
          >
            {subtitle}
          </Text>
          {buddy.unreadCount > 0 ? (
            <View
              accessibilityLabel={`읽지 않은 메시지 ${buddy.unreadCount}건`}
              style={{
                minWidth: 22,
                paddingHorizontal: space[2],
                paddingVertical: 2,
                borderRadius: radius.full,
                backgroundColor: color('primary'),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: color('on-primary'),
                  fontSize: fontSize.caption,
                  fontWeight: '700',
                }}
              >
                {buddy.unreadCount > 99 ? '99+' : buddy.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            marginTop: space[2],
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: radius.full,
              backgroundColor: color(online ? 'success' : 'offline'),
            }}
          />
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
            {online ? '연결됨' : '연결 안 됨'}
            {buddy.username ? ` · @${buddy.username}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
