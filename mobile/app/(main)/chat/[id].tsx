/**
 * S-11 · 채팅 화면 (UC-04). Streaming render, markdown, trace, message status, Stop
 * control, and live long-poll lifecycle. Failed user messages → long-press → D-02.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, FlatList, KeyboardAvoidingView, Platform, Pressable, Modal } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import * as Clipboard from "expo-clipboard";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useChatStore } from "@/application/stores/chat";
import { useAuthStore } from "@/application/stores/auth";
import { useTasksStore } from "@/application/stores/tasks";
import { useArtifactsStore } from "@/application/stores/artifacts";
import { useFormsStore } from "@/application/stores/forms";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatInputBar } from "@/components/ChatInputBar";
import { Avatar } from "@/components/Avatar";
import type { Message } from "@/domain/entities";

/** Telegram message id from a "tg-{id}" message id (undefined for optimistic/mock messages). */
function tgIdOf(m: Message): number | undefined {
  return m.id.startsWith("tg-") ? Number(m.id.slice(3)) : undefined;
}
/** A short quote of a message for the reply bar. */
function messageSnippet(m: Message): string {
  if (m.text) return m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text;
  if (m.attachments?.length) return `📎 ${m.attachments[0]!.name}`;
  return "(첨부)";
}

export default function ChatScreen() {
  const { color } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const buddy = useBuddiesStore((s) => s.buddies.find((b) => b.id === id));
  const messages = useChatStore((s) => (id ? s.byBuddy[id] ?? [] : []));
  const streamingId = useChatStore((s) => (id ? s.streamingMessageId[id] : undefined));
  const hydrate = useChatStore((s) => s.hydrate);
  const hydrateTasks = useTasksStore((s) => s.hydrate);
  const hydrateArtifacts = useArtifactsStore((s) => s.hydrate);
  const hydrateForms = useFormsStore((s) => s.hydrate);
  const send = useChatStore((s) => s.send);
  const sendAttachments = useChatStore((s) => s.sendAttachments);
  const stop = useChatStore((s) => s.stop);
  const retry = useChatStore((s) => s.retry);
  const startPolling = useChatStore((s) => s.startPolling);
  const stopPolling = useChatStore((s) => s.stopPolling);
  const catchUp = useChatStore((s) => s.catchUp);
  const awaiting = useChatStore((s) => (id ? !!s.awaiting[id] : false));
  const tasks = useTasksStore((s) => (id ? s.byBuddy[id] ?? [] : []));
  const sessionConnected = useAuthStore((s) => s.connected);
  const refreshStatus = useAuthStore((s) => s.refreshStatus);

  const markRead = useBuddiesStore((s) => s.markRead);
  const updateBuddy = useBuddiesStore((s) => s.update);

  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<{ messageId?: number; text: string } | null>(null);
  const PAGE = 20;
  const [visible, setVisible] = useState(PAGE);
  const listRef = useRef<FlatList>(null);
  const nearBottom = useRef(false);
  const loadingOlder = useRef(false);
  const prevLen = useRef(0);
  const inited = useRef(false);
  const savedLastReadId = useRef<string | undefined>(undefined);
  // Id of the bottom-most on-screen message — the actual read position to persist on leave.
  const lastVisibleId = useRef<string | undefined>(undefined);

  // Windowed view: render the last `visible` messages; scrolling up loads older in
  // PAGE-sized chunks. maintainVisibleContentPosition keeps the viewport stable on prepend.
  const data = messages.length > visible ? messages.slice(messages.length - visible) : messages;
  const hasOlder = messages.length > visible;

  // Track which message is at the bottom of the viewport (= how far the user has read).
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item: Message }> }) => {
      const items = info.viewableItems;
      if (items.length) lastVisibleId.current = items[items.length - 1]?.item.id;
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;

  useEffect(() => {
    if (!id) return;
    // Capture the last-read message id (for the restore-scroll) before clearing the badge.
    savedLastReadId.current = useBuddiesStore.getState().buddies.find((b) => b.id === id)?.lastReadId;
    void hydrate(id);
    void hydrateTasks(id);
    void hydrateArtifacts(id);
    void hydrateForms(id);
    void startPolling(id);
    markRead(id);
    return () => {
      stopPolling(id);
      // Persist the bottom-most message the user actually saw, so the next open resumes there.
      if (lastVisibleId.current) updateBuddy(id, { lastReadId: lastVisibleId.current });
    };
  }, [id, hydrate, hydrateTasks, hydrateArtifacts, hydrateForms, startPolling, stopPolling, markRead, updateBuddy]);

  // Keep the relay-session "connected" indicator fresh while the chat is open.
  useEffect(() => {
    void refreshStatus();
    const t = setInterval(() => void refreshStatus(), 15000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Initial position: restore the last-read message (Telegram-style), else jump to the bottom.
  useEffect(() => {
    if (inited.current || messages.length === 0) return;
    inited.current = true;
    prevLen.current = messages.length;
    const target = savedLastReadId.current;
    const idx = target ? data.findIndex((m) => m.id === target) : -1;
    // If there are messages after the last-read one (unread), show the FIRST UNREAD at the top
    // (Telegram-style) so the user reads downward. Otherwise jump to the bottom. Delay so the
    // windowed rows (initialNumToRender) are measured first — scrollToIndex needs that, else it
    // fails with averageItemLength=0 and lands at the top.
    setTimeout(() => {
      if (idx >= 0 && idx < data.length - 1) {
        listRef.current?.scrollToIndex({ index: idx + 1, animated: false, viewPosition: 0 });
      } else {
        listRef.current?.scrollToEnd({ animated: false });
        nearBottom.current = true; // starting at the bottom → new messages should autoscroll
      }
    }, 250);
  }, [messages.length, data, visible]);

  // New messages while the chat is open: clear unread + autoscroll if near the bottom.
  useEffect(() => {
    if (!inited.current) return;
    if (messages.length > prevLen.current) {
      if (id) markRead(id);
      if (nearBottom.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
    prevLen.current = messages.length;
  }, [messages.length, id, markRead]);

  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    if (contentOffset.y < 80 && hasOlder && !loadingOlder.current) {
      loadingOlder.current = true;
      setVisible((v) => v + PAGE);
    } else if (contentOffset.y > 240) {
      loadingOlder.current = false; // re-arm once scrolled away from the top
    }
  };

  if (!buddy || !id) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }}>
        <Stack.Screen options={{ title: "채팅" }} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space[6] }}>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>존재하지 않는 친구입니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const connected = buddy.live ? sessionConnected : buddy.connected;
  const activeTask = [...tasks]
    .reverse()
    .find((t) => t.status !== "completed" && t.status !== "archived");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Avatar name={buddy.displayName} accent={buddy.accent} size={32} />
              <View>
                <Text style={{ color: color("text-primary"), fontWeight: "600", fontSize: fontSize["title-sm"] }}>{buddy.displayName}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: radius.full,
                      backgroundColor: color(connected ? "success" : "error"),
                    }}
                  />
                  <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
                    {connected ? "연결됨" : "연결 끊김"}
                  </Text>
                </View>
              </View>
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // iOS has no window resize, so the view must pad itself above the keyboard.
        // Android sets windowSoftInputMode=adjustResize (AndroidManifest), which already
        // shrinks the window above the IME — adding `behavior="height"` on top of that
        // double-compensates and leaves the composer hidden behind the keyboard, so we let
        // the OS resize do the work (behavior undefined) on Android.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        {activeTask ? (
          <View
            style={{
              paddingHorizontal: space[4],
              paddingVertical: space[2],
              borderBottomWidth: 1,
              borderBottomColor: color("border"),
              backgroundColor: color("surface-elevated"),
            }}
          >
            <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }} numberOfLines={1}>
              작업 · {activeTask.title}
            </Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }} numberOfLines={1}>
              {activeTask.status === "needs_input" ? "입력이 필요합니다" : activeTask.status === "review_needed" ? "검토가 필요합니다" : "진행 중"}
            </Text>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={data}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(m) => m.id}
          onScroll={onScroll}
          scrollEventThrottle={32}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          windowSize={21}
          // Render the whole window up front so scrollToIndex (restore position) finds a
          // measured target instead of failing with averageItemLength=0.
          initialNumToRender={visible}
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            // Target still not measured: jump to a rough offset, then retry once items render.
            if (averageItemLength > 0) listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: false }), 200);
          }}
          renderItem={({ item }) => <ChatBubble message={item} onLongPress={() => setActionFor(item)} />}
          ListEmptyComponent={() => (
            <View style={{ padding: space[6], alignItems: "center" }}>
              <View style={{ backgroundColor: color("surface-elevated"), paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: radius.lg }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>대화를 시작해 보세요.</Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: space[3], flexGrow: 1 }}
        />

        {awaiting ? (
          <View style={{ paddingHorizontal: space[4], paddingBottom: space[1] }}>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>● ● ●  {buddy.displayName} 입력 중…</Text>
          </View>
        ) : null}

        {streamingId ? (
          <View style={{ alignItems: "center", paddingBottom: space[2] }}>
            <Pressable
              onPress={() => stop(id)}
              accessibilityRole="button"
              accessibilityLabel="응답 중단"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space[2],
                backgroundColor: color("surface-elevated"),
                borderWidth: 1,
                borderColor: color("border"),
                borderRadius: radius.full,
                paddingHorizontal: space[4],
                paddingVertical: space[2],
              }}
            >
              <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "600" }}>■ 중단</Text>
            </Pressable>
          </View>
        ) : null}

        {replyTo ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              paddingHorizontal: space[4],
              paddingVertical: space[2],
              backgroundColor: color("surface"),
              borderTopWidth: 1,
              borderTopColor: color("border"),
            }}
          >
            <View style={{ width: 3, alignSelf: "stretch", backgroundColor: color("primary"), borderRadius: radius.full }} />
            <Text style={{ flex: 1, color: color("text-secondary"), fontSize: fontSize["body-sm"] }} numberOfLines={1}>
              답장: {replyTo.text}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="답장 취소">
              <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        <ChatInputBar
          onSend={(text) => {
            void send(id, text, replyTo ?? undefined);
            setReplyTo(null);
          }}
          onAttachMany={(items, caption) => void sendAttachments(id, items, caption)}
          placeholder={connected ? "메시지 보내기" : "오프라인 — 연결되면 전송됩니다"}
        />
      </KeyboardAvoidingView>

      {/* Message actions: copy / reply / retry */}
      <Modal visible={actionFor !== null} transparent animationType="slide" onRequestClose={() => setActionFor(null)}>
        <Pressable accessible={false} onPress={() => setActionFor(null)} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }}>
          <Pressable
            accessible={false}
            style={{ backgroundColor: color("surface"), borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingVertical: space[2], paddingBottom: space[6] }}
          >
            <View style={{ alignItems: "center", paddingVertical: space[2] }}>
              <View style={{ width: 40, height: 4, borderRadius: radius.full, backgroundColor: color("border") }} />
            </View>
            {(() => {
              const ActionRow = ({ icon, label, danger, onPress }: { icon: string; label: string; danger?: boolean; onPress: () => void }) => (
                <Pressable
                  onPress={onPress}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space[3],
                    paddingHorizontal: space[5],
                    paddingVertical: space[4],
                    minHeight: touch.min,
                    backgroundColor: pressed ? color("surface-elevated") : color("surface"),
                  })}
                >
                  <Text style={{ fontSize: fontSize["title-sm"] }}>{icon}</Text>
                  <Text style={{ color: danger ? color("error") : color("text-primary"), fontSize: fontSize.body }}>{label}</Text>
                </Pressable>
              );
              const m = actionFor;
              if (!m) return null;
              return (
                <>
                  {m.text ? (
                    <ActionRow
                      icon="📋"
                      label="복사"
                      onPress={() => {
                        void Clipboard.setStringAsync(m.text);
                        setActionFor(null);
                      }}
                    />
                  ) : null}
                  <ActionRow
                    icon="↩️"
                    label="답장"
                    onPress={() => {
                      setReplyTo({ messageId: tgIdOf(m), text: messageSnippet(m) });
                      setActionFor(null);
                    }}
                  />
                  {m.role === "user" && m.status === "failed" ? (
                    <ActionRow
                      icon="🔄"
                      label="재전송"
                      onPress={() => {
                        void retry(id, m.id);
                        setActionFor(null);
                      }}
                    />
                  ) : null}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
