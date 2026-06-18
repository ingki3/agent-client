/**
 * S-10 · 친구(에이전트) 리스트 (Home)
 *
 * - FlashList of `Buddy` rows (PRD FR-09 — 100건에서도 60fps 목표)
 * - 빈 상태 → S-10-EMPTY 분기
 * - FAB [+] → /add-buddy/token (S-12)
 * - 우상단 [설정] → /settings (BIZ-269 가 실 구현)
 * - 카드 길게 누름 → M-02 BottomSheet → [삭제] → D-04 확정 → removeBuddyFlow
 * - 당겨서 새로고침 → refreshBuddies (실제 getUpdates 는 BIZ-266 에서 wire-in)
 */
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useNetworkStore } from '@/application/stores/network';
import type { Buddy, BuddyId } from '@/domain/entities/Buddy';
import { BuddyListItem } from '@/ui/buddies/BuddyListItem';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

import { initBuddiesRuntime, refreshBuddies, removeBuddyFlow, syncRelayPeersToLocal } from '../_runtime/buddies';

export default function BuddiesScreen() {
  const { color } = useTheme();
  const router = useRouter();

  const buddiesMap = useBuddiesStore((s) => s.buddies);
  const order = useBuddiesStore((s) => s.order);
  const online = useNetworkStore((s) => s.online);

  const [refreshing, setRefreshing] = useState(false);
  const [quickActionFor, setQuickActionFor] = useState<Buddy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Buddy | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    initBuddiesRuntime();
  }, []);

  useFocusEffect(
    useCallback(() => {
      initBuddiesRuntime();
      void syncRelayPeersToLocal().catch(() => {
        refreshBuddies();
      });
      return undefined;
    }, []),
  );

  const buddies = useMemo<Buddy[]>(
    () => order.map((id) => buddiesMap[id]).filter((b): b is Buddy => b !== undefined),
    [order, buddiesMap],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncRelayPeersToLocal();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleDelete = useCallback(async (buddyId: BuddyId) => {
    setDeleting(true);
    try {
      await removeBuddyFlow(buddyId);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, []);

  const renderItem: ListRenderItem<Buddy> = useCallback(
    ({ item }) => (
      <BuddyListItem
        buddy={item}
        online={online}
        onPress={() => router.push(`/chat/${item.id}`)}
        onLongPress={() => setQuickActionFor(item)}
      />
    ),
    [online, router],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '친구',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="설정"
              hitSlop={8}
              style={{ paddingHorizontal: space[2] }}
            >
              <Text style={{ color: color('primary'), fontSize: fontSize.body }}>설정</Text>
            </Pressable>
          ),
        }}
      />

      {buddies.length === 0 ? (
        <EmptyState onAdd={() => router.push('/add-buddy/token')} />
      ) : (
        <FlashList
          data={buddies}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={color('primary')}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: color('border'), marginLeft: 76 }} />
          )}
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      )}

      <Pressable
        onPress={() => router.push('/add-buddy/token')}
        accessibilityRole="button"
        accessibilityLabel="친구 추가"
        style={({ pressed }) => ({
          position: 'absolute',
          right: space[5],
          bottom: space[5],
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: color('primary'),
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        })}
      >
        <Text
          style={{
            color: color('on-primary'),
            fontSize: 28,
            fontWeight: '300',
            lineHeight: 30,
          }}
        >
          +
        </Text>
      </Pressable>

      <QuickActionsSheet
        buddy={quickActionFor}
        onDismiss={() => setQuickActionFor(null)}
        onDelete={(b) => {
          setQuickActionFor(null);
          setDeleteTarget(b);
        }}
      />

      <DeleteConfirmDialog
        buddy={deleteTarget}
        submitting={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={(id) => handleDelete(id)}
      />
    </SafeAreaView>
  );
}

const keyExtractor = (b: Buddy) => b.id;

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { color } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[6],
        gap: space[4],
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: radius.full,
          backgroundColor: color('surface-elevated'),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 40 }}>👋</Text>
      </View>
      <Text
        style={{
          color: color('text-primary'),
          fontSize: fontSize['title-md'],
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        아직 친구가 없어요
      </Text>
      <Text
        style={{
          color: color('text-secondary'),
          fontSize: fontSize['body-sm'],
          textAlign: 'center',
          lineHeight: 20,
        }}
      >
        텔레그램 봇 토큰으로 첫 친구(에이전트)를 추가해 보세요. 토큰은 이 기기에만 안전하게
        저장됩니다.
      </Text>
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="첫 친구 추가하기"
        style={{
          backgroundColor: color('primary'),
          borderRadius: radius.full,
          paddingHorizontal: space[6],
          paddingVertical: space[3],
          minHeight: touch.min,
          justifyContent: 'center',
        }}
      >
        <Text
          style={{ color: color('on-primary'), fontSize: fontSize.body, fontWeight: '700' }}
        >
          + 친구 추가
        </Text>
      </Pressable>
    </View>
  );
}

function QuickActionsSheet({
  buddy,
  onDismiss,
  onDelete,
}: {
  buddy: Buddy | null;
  onDismiss: () => void;
  onDelete: (buddy: Buddy) => void;
}) {
  const { color } = useTheme();
  return (
    <Modal
      visible={buddy !== null}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityLabel="닫기"
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: color('surface'),
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingBottom: space[6],
            paddingTop: space[3],
            paddingHorizontal: space[4],
            gap: space[2],
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: radius.full,
              backgroundColor: color('border'),
              marginBottom: space[3],
            }}
          />
          {buddy ? (
            <View style={{ paddingHorizontal: space[2], paddingBottom: space[3] }}>
              <Text
                style={{
                  color: color('text-primary'),
                  fontSize: fontSize['title-sm'],
                  fontWeight: '700',
                }}
              >
                {buddy.displayName}
              </Text>
              {buddy.username ? (
                <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>
                  @{buddy.username}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Pressable
            onPress={() => buddy && onDelete(buddy)}
            accessibilityRole="button"
            accessibilityLabel="친구 삭제"
            style={({ pressed }) => ({
              paddingHorizontal: space[4],
              paddingVertical: space[4],
              backgroundColor: pressed ? color('surface-elevated') : 'transparent',
              borderRadius: radius.lg,
            })}
          >
            <Text style={{ color: color('error'), fontSize: fontSize.body, fontWeight: '600' }}>
              삭제
            </Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="닫기"
            style={({ pressed }) => ({
              paddingHorizontal: space[4],
              paddingVertical: space[4],
              backgroundColor: pressed ? color('surface-elevated') : 'transparent',
              borderRadius: radius.lg,
            })}
          >
            <Text style={{ color: color('text-secondary'), fontSize: fontSize.body }}>닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DeleteConfirmDialog({
  buddy,
  submitting,
  onCancel,
  onConfirm,
}: {
  buddy: Buddy | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (id: BuddyId) => void;
}) {
  const { color } = useTheme();
  return (
    <Modal
      visible={buddy !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: space[5],
        }}
      >
        <View
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: color('surface'),
            borderRadius: radius.lg,
            padding: space[5],
            gap: space[4],
          }}
        >
          <Text
            style={{
              color: color('text-primary'),
              fontSize: fontSize['title-sm'],
              fontWeight: '700',
            }}
          >
            친구를 삭제할까요?
          </Text>
          <Text
            style={{
              color: color('text-secondary'),
              fontSize: fontSize['body-sm'],
              lineHeight: 20,
            }}
          >
            {buddy
              ? `“${buddy.displayName}” 와의 대화 로그가 함께 삭제됩니다. 이 작업은 되돌릴 수 없어요.`
              : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'flex-end' }}>
            <Pressable
              onPress={onCancel}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="취소"
              style={{
                paddingHorizontal: space[4],
                paddingVertical: space[2],
                minHeight: touch.min,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: color('text-secondary'), fontSize: fontSize.body }}>취소</Text>
            </Pressable>
            <Pressable
              onPress={() => buddy && onConfirm(buddy.id)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="삭제"
              style={{
                paddingHorizontal: space[4],
                paddingVertical: space[2],
                backgroundColor: submitting ? color('surface-elevated') : color('error'),
                borderRadius: radius.full,
                minHeight: touch.min,
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: submitting ? color('text-disabled') : '#FFFFFF',
                  fontSize: fontSize.body,
                  fontWeight: '700',
                }}
              >
                {submitting ? '삭제 중…' : '삭제'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
