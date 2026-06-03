/**
 * S-11 · 1:1 채팅 화면 (BIZ-266, UC-04 본문).
 *
 * 책임:
 *   - SQLite history hydrate (`hydrateChatScreen`) + `useChatStore` 구독
 *   - 입력바 [전송] → `sendMessageFlow` (offline / failure / outbox 분기 포함)
 *   - 길게 누름 (D-02) → 재전송 / 삭제 / 취소 시트
 *   - 자동 스크롤 + 키보드 회피 (iOS padding / Android height)
 *   - polling 시작/정지 (`startPolling`)
 *   - 상단 오프라인 배너 (D-06) — composition root 가 NetInfo 와 동기화
 *
 * Trace / 스트리밍 패널은 BIZ-#6 (다음 이슈) 범위.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';

import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useChatStore } from '@/application/stores/chat-store';
import { useNetworkStore } from '@/application/stores/network-store';
import type { Message } from '@/domain/entities/Message';
import { ChatBubbleV2, OfflineBanner } from '@/ui/chat';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

import {
  deleteMessageFlow,
  hydrateChatScreen,
  initChatRuntime,
  retryMessageFlow,
  sendMessageFlow,
  startPolling,
} from '../../_runtime/chat';

export default function ChatScreen() {
  const { color } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const buddyId = id;

  const buddy = useBuddiesStore((s) => (buddyId ? s.buddies[buddyId] : undefined));
  const messageIds = useChatStore((s) => (buddyId ? s.byBuddy[buddyId] : undefined)) ?? [];
  const messagesMap = useChatStore((s) => s.messages);
  const isOnline = useNetworkStore((s) => s.isOnline);

  const messages = useMemo(
    () => messageIds.map((id_) => messagesMap[id_]).filter((m): m is Message => Boolean(m)),
    [messageIds, messagesMap],
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlashListRef<Message>>(null);

  // Boot the runtime + hydrate SQLite history once per screen mount.
  useEffect(() => {
    if (!buddyId) return;
    initChatRuntime();
    hydrateChatScreen(buddyId);
    const stop = startPolling(buddyId);
    return () => stop();
  }, [buddyId]);

  // Auto-scroll to bottom when new messages arrive (S-11 자동 스크롤).
  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !buddyId || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessageFlow(buddyId, text);
    } finally {
      setSending(false);
    }
  }, [buddyId, draft, sending]);

  const handleLongPress = useCallback(
    (message: Message) => {
      const onAction = async (action: 'retry' | 'delete' | 'cancel') => {
        if (action === 'retry') {
          await retryMessageFlow(message.clientMessageId);
        } else if (action === 'delete') {
          await deleteMessageFlow(message.clientMessageId);
          if (buddyId) hydrateChatScreen(buddyId);
        }
      };
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['재전송', '삭제', '취소'],
            destructiveButtonIndex: 1,
            cancelButtonIndex: 2,
            title: '메시지 옵션',
            message: '전송 실패 / 대기 중 메시지를 어떻게 할까요?',
          },
          (idx) => {
            if (idx === 0) void onAction('retry');
            else if (idx === 1) void onAction('delete');
          },
        );
      } else {
        Alert.alert('메시지 옵션', '전송 실패 / 대기 중 메시지를 어떻게 할까요?', [
          { text: '재전송', onPress: () => void onAction('retry') },
          { text: '삭제', style: 'destructive', onPress: () => void onAction('delete') },
          { text: '취소', style: 'cancel' },
        ]);
      }
    },
    [buddyId],
  );

  if (!buddyId || !buddy) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }}>
        <Stack.Screen options={{ title: '채팅' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] }}>
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.body, marginBottom: space[3] }}>
            존재하지 않는 친구입니다.
          </Text>
          <Pressable onPress={() => router.replace('/buddies')} hitSlop={8}>
            <Text style={{ color: color('primary'), fontSize: fontSize.body }}>친구 목록으로</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const placeholder = isOnline ? '메시지 보내기' : '오프라인 — 연결되면 전송됩니다';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => <HeaderTitle buddy={buddy} isOnline={isOnline} />,
          headerBackTitle: '뒤로',
        }}
      />

      <OfflineBanner />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlashList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.clientMessageId}
          renderItem={({ item }) => (
            <ChatBubbleV2 message={item} onLongPress={handleLongPress} />
          )}
          ListEmptyComponent={() => (
            <View style={{ padding: space[6], alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: color('surface-elevated'),
                  paddingHorizontal: space[4],
                  paddingVertical: space[3],
                  borderRadius: radius.lg,
                }}
              >
                <Text style={{ color: color('text-secondary'), fontSize: fontSize['body-sm'] }}>
                  대화가 비어 있어요. 메시지를 보내 시작해 보세요.
                </Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: space[3] }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: space[3],
            paddingTop: space[2],
            paddingBottom: space[2],
            borderTopWidth: 1,
            borderTopColor: color('border'),
            backgroundColor: color('surface'),
            gap: space[2],
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: color('surface-elevated'),
              borderRadius: radius.xl,
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              borderWidth: 1,
              borderColor: color('border'),
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor={color('text-secondary')}
              multiline
              style={{
                fontSize: fontSize.body,
                color: color('text-primary'),
                maxHeight: 120,
                minHeight: 24,
              }}
              editable={!sending}
              returnKeyType="send"
              blurOnSubmit={false}
            />
          </View>
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="메시지 보내기"
            style={{
              minWidth: touch.min,
              minHeight: touch.min,
              borderRadius: radius.full,
              backgroundColor: draft.trim() && !sending ? color('primary') : color('border'),
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space[3],
            }}
          >
            <Text style={{ color: color('on-primary'), fontWeight: '700', fontSize: fontSize.body }}>
              전송
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HeaderTitle({
  buddy,
  isOnline,
}: {
  buddy: { displayName: string; username: string };
  isOnline: boolean;
}) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: 'column', alignItems: 'center' }}>
      <Text
        style={{
          color: color('text-primary'),
          fontWeight: '700',
          fontSize: fontSize['title-sm'],
        }}
        numberOfLines={1}
      >
        {buddy.displayName}
      </Text>
      <Text
        style={{
          color: isOnline ? color('success') : color('offline'),
          fontSize: fontSize.caption,
        }}
      >
        {isOnline ? '● 연결됨' : '○ 오프라인'}
        {buddy.username ? ` · @${buddy.username}` : ''}
      </Text>
    </View>
  );
}
