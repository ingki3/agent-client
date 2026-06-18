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
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useChatStore } from '@/application/stores/chat-store';
import { useNetworkStore } from '@/application/stores/network-store';
import type { Message } from '@/domain/entities/Message';
import { ChatBubbleV2, ChatComposer, OfflineBanner, useChatAutoScroll } from '@/ui/chat';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

import {
  deleteMessageFlow,
  hydrateChatScreen,
  initChatRuntime,
  markBuddyRead,
  retryMessageFlow,
  sendAttachmentFlow,
  sendMessageFlow,
  startPolling,
} from '../../_runtime/chat';
import { useChatAttachments } from './useChatAttachments';

export default function ChatScreen() {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const buddyId = id;

  const buddy = useBuddiesStore((s) => (buddyId ? s.buddies[buddyId] : undefined));
  const messageIds = useChatStore((s) => (buddyId ? s.byBuddy[buddyId] : undefined)) ?? [];
  const messagesMap = useChatStore((s) => s.messages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const isOnline = useNetworkStore((s) => s.isOnline);

  const messages = useMemo(
    () => messageIds.map((id_) => messagesMap[id_]).filter((m): m is Message => Boolean(m)),
    [messageIds, messagesMap],
  );

  const [draft, setDraft] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const [sending, setSending] = useState(false);
  const { listRef, scrollToLatest, handleScroll } = useChatAutoScroll(messages);
  const {
    attaching,
    pendingAttachments,
    openAttachMenu,
    removePendingAttachment,
    clearPendingAttachments,
  } = useChatAttachments({
    buddyId,
  });

  // Boot the runtime + hydrate SQLite history once per screen mount.
  useEffect(() => {
    if (!buddyId) return;
    initChatRuntime();
    hydrateChatScreen(buddyId);
    markBuddyRead(buddyId);
    scrollToLatest(false);
    const stop = startPolling(buddyId);
    return () => stop();
  }, [buddyId, scrollToLatest]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      const overlap =
        keyboardTop > 0
          ? Math.max(0, windowHeight - keyboardTop - insets.bottom)
          : Math.max(0, event.endCoordinates.height - insets.bottom);
      setKeyboardInset(overlap);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom, windowHeight]);

  useEffect(() => {
    if (keyboardInset <= 0) return;
    scrollToLatest(true);
  }, [keyboardInset, scrollToLatest]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    const attachments = pendingAttachments;
    if ((!text && !attachments.length) || !buddyId || sending) return;
    if (attachments.length) {
      setSending(true);
      setDraft('');
      clearPendingAttachments();
      try {
        const files = attachments
          .filter((item) => item.type === 'file')
          .map((item) => item.file);
        const locations = attachments
          .filter((item) => item.type === 'location')
          .map((item) => item.url);
        const locationText = locations.map((url) => `[내 위치 보기](${url})`).join('\n');
        const fullCaption = [text, locationText].filter(Boolean).join('\n');

        for (let index = 0; index < files.length; index += 1) {
          const sent = await sendAttachmentFlow(buddyId, files[index]!, index === 0 ? fullCaption : '');
          if (sent.status === 'failed') {
            throw new Error('attachment_send_failed');
          }
        }
        if (!files.length && fullCaption) {
          await sendMessageFlow(buddyId, fullCaption);
        }
      } catch {
        Alert.alert('첨부 전송 실패', '파일을 전송하지 못했습니다. relay 연결을 확인해 주세요.');
      } finally {
        setSending(false);
      }
      return;
    }
    const createdAt = Date.now();
    const clientMessageId = `local-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: null,
      clientMessageId,
      buddyId,
      role: 'user',
      text,
      status: isOnline ? 'sending' : 'queued',
      createdAt,
      traceId: null,
    };
    setSending(true);
    setDraft('');
    appendMessage(optimistic);
    try {
      await sendMessageFlow(buddyId, text, { clientMessageId, createdAt });
    } catch {
      useChatStore.getState().setStatus(clientMessageId, 'failed');
    } finally {
      setSending(false);
    }
  }, [
    appendMessage,
    buddyId,
    clearPendingAttachments,
    draft,
    isOnline,
    pendingAttachments,
    sending,
  ]);

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
  const composerBottomInset = Platform.OS === 'android' ? keyboardInset : 0;
  const listBottomPadding =
    space[3] + Math.max(composerHeight, touch.min + space[4]) + composerBottomInset;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color('surface') }} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitleAlign: 'center',
          headerTitle: () => <HeaderTitle buddy={buddy} isOnline={isOnline} />,
          headerRight: () => <View style={{ width: touch.min }} />,
          headerBackTitle: '뒤로',
        }}
      />

      <OfflineBanner />

      <KeyboardAvoidingView
        style={{ flex: 1, position: 'relative' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlashList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.clientMessageId}
          onScroll={handleScroll}
          scrollEventThrottle={100}
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
          contentContainerStyle={{
            paddingTop: space[3],
            paddingBottom: listBottomPadding,
          }}
        />

        <ChatComposer
          draft={draft}
          placeholder={placeholder}
          sending={sending}
          attaching={attaching}
          pendingAttachments={pendingAttachments}
          bottomInset={composerBottomInset}
          onDraftChange={setDraft}
          onSend={handleSend}
          onOpenAttachMenu={openAttachMenu}
          onRemovePendingAttachment={removePendingAttachment}
          onLayoutHeight={setComposerHeight}
        />
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
    <View style={{ flexDirection: 'column', alignItems: 'center', minWidth: 180 }}>
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
        numberOfLines={1}
      >
        {isOnline ? '● 연결됨' : '○ 오프라인'}
        {buddy.username ? ` · @${buddy.username}` : ''}
      </Text>
    </View>
  );
}
