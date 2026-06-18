/**
 * D-06 — 상단 오프라인 배너 (TECH §3.4, USER_FLOW D-06).
 *
 * `useNetworkStore` 가 isOnline=false 일 때만 표시. 큐잉 카운트가 있으면 함께
 * 안내 ("3개 대기 중"). 접근성: `role=status` + `aria-live=polite` 의미를 RN
 * accessibilityLiveRegion 으로 매핑.
 */
import { Text, View } from 'react-native';

import { useNetworkStore } from '@/application/stores/network-store';

import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

export function OfflineBanner() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const pending = useNetworkStore((s) => s.pendingOutboxCount);
  const { color } = useTheme();
  if (isOnline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: space[3],
        marginTop: space[2],
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        backgroundColor: color('warning'),
        borderRadius: radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[2],
      }}
    >
      <Text style={{ color: color('text-inverse'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
        오프라인 — 연결되면 자동으로 다시 전송합니다
      </Text>
      {pending > 0 ? (
        <Text style={{ color: color('text-inverse'), fontSize: fontSize.caption }}>
          {pending}개 대기 중
        </Text>
      ) : null}
    </View>
  );
}
