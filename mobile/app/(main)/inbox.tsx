/**
 * S-20 · 통합 Inbox (Home)
 * pen frame: ENx49 (Light) / pHwKo (Dark)
 * Empty-state variant: Fe8kO (Light) / vrHVG (Dark) → renders inline when buddies.length === 0.
 */
import { useRouter, Stack } from 'expo-router';
import { View, Text, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBuddiesStore } from '@/application/stores/buddies';
import { BuddyRow } from '@/ui/components/BuddyRow';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

export default function InboxScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const buddies = useBuddiesStore((s) => s.buddies);

  const totalUnread = buddies.reduce((sum, b) => sum + b.unread, 0);

  if (buddies.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Inbox' }} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space[6],
            gap: space[4],
          }}
        >
          <Text style={{ fontSize: 56 }}>📭</Text>
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-lg'],
              fontWeight: '700',
              textAlign: 'center',
            }}
          >
            아직 등록된 버디가 없어요
          </Text>
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize.body,
              textAlign: 'center',
            }}
          >
            첫 버디를 추가해 에이전트와 대화를 시작해 보세요.
          </Text>
          <Pressable
            onPress={() => router.push('/add-buddy')}
            style={{
              backgroundColor: color('primary'),
              paddingHorizontal: space[6],
              paddingVertical: space[3],
              borderRadius: radius.full,
              minHeight: touch.min,
              justifyContent: 'center',
              marginTop: space[4],
            }}
          >
            <Text
              style={{ color: color('on-primary'), fontWeight: '700', fontSize: fontSize.body }}
            >
              버디 추가하기
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Inbox',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/buddies')}
              accessibilityLabel="버디 목록 열기"
              hitSlop={8}
              style={{ paddingHorizontal: space[2] }}
            >
              <Text style={{ color: color('primary'), fontSize: fontSize.body, fontWeight: '600' }}>
                버디
              </Text>
            </Pressable>
          ),
        }}
      />

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: space[4],
          paddingTop: space[2],
          paddingBottom: space[2],
        }}
      >
        <Text style={{ color: color('text-secondary'), fontSize: fontSize['body-sm'] }}>
          {buddies.length}개 버디 · 읽지 않음 {totalUnread}건
        </Text>
      </View>

      <FlatList
        data={buddies}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <BuddyRow buddy={item} onPress={() => router.push(`/chat/${item.id}`)} />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: color('border'), marginLeft: 76 }} />
        )}
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      <Pressable
        onPress={() => router.push('/add-buddy')}
        accessibilityLabel="버디 추가"
        accessibilityRole="button"
        style={{
          position: 'absolute',
          right: space[5],
          bottom: space[6],
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: color('primary'),
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Text
          style={{ color: color('on-primary'), fontSize: 28, fontWeight: '300', marginTop: -2 }}
        >
          +
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}
