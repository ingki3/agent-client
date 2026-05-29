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
import { useBuddiesStore } from "@/application/stores/buddies";
import { useChatStore } from "@/application/stores/chat";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatInputBar } from "@/components/ChatInputBar";
import { Avatar } from "@/components/Avatar";
import type { Message } from "@/domain/entities";

export default function ChatScreen() {
  const { color } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const buddy = useBuddiesStore((s) => s.buddies.find((b) => b.id === id));
  const messages = useChatStore((s) => (id ? s.byBuddy[id] ?? [] : []));
  const streamingId = useChatStore((s) => (id ? s.streamingMessageId[id] : undefined));
  const hydrate = useChatStore((s) => s.hydrate);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const retry = useChatStore((s) => s.retry);
  const startPolling = useChatStore((s) => s.startPolling);
  const stopPolling = useChatStore((s) => s.stopPolling);

  const [retryFor, setRetryFor] = useState<Message | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!id) return;
    void hydrate(id);
    void startPolling(id);
    return () => stopPolling(id);
  }, [id, hydrate, startPolling, stopPolling]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color("surface") }} edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Avatar name={buddy.displayName} accent={buddy.accent} size={32} />
              <View>
                <Text style={{ color: color("text-primary"), fontWeight: "600", fontSize: fontSize["title-sm"] }}>{buddy.displayName}</Text>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
                  {buddy.connected ? "● 연결됨" : "○ 연결 안 됨"}
                </Text>
              </View>
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <ChatBubble
              message={item}
              onLongPress={item.role === "user" && item.status === "failed" ? () => setRetryFor(item) : undefined}
            />
          )}
          ListEmptyComponent={() => (
            <View style={{ padding: space[6], alignItems: "center" }}>
              <View style={{ backgroundColor: color("surface-elevated"), paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: radius.lg }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>대화를 시작해 보세요.</Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: space[3], flexGrow: 1 }}
        />

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

        <ChatInputBar
          onSend={(text) => void send(id, text)}
          placeholder={buddy.connected ? "메시지 보내기" : "오프라인 — 연결되면 전송됩니다"}
        />
      </KeyboardAvoidingView>

      {/* D-02 · 송신 실패 재시도 */}
      <Modal visible={retryFor !== null} transparent animationType="fade" onRequestClose={() => setRetryFor(null)}>
        <View style={{ flex: 1, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center", padding: space[6] }}>
          <View style={{ backgroundColor: color("surface"), borderRadius: radius.xl, padding: space[5], gap: space[4], width: "100%", maxWidth: 360 }}>
            <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>전송 실패</Text>
            <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>이 메시지를 다시 보낼까요?</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[4] }}>
              <Pressable onPress={() => setRetryFor(null)} style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}>
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (retryFor) void retry(id, retryFor.id);
                  setRetryFor(null);
                }}
                style={{ minHeight: touch.min, justifyContent: "center", paddingHorizontal: space[3] }}
              >
                <Text style={{ color: color("primary"), fontSize: fontSize.body, fontWeight: "700" }}>재전송</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
