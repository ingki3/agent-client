/**
 * S-22 · 채팅 화면 (Conversation)
 * pen frame: YWrBi (Light) / q9HQt (Dark)
 * Includes the message input bar (FR-01 / FR-12) and chat bubbles (FR-02, FR-33).
 * Trace summary chip is rendered when message.traceSummary present (FR-24 접힘 상태 preview).
 */
import { useEffect, useRef } from "react";
import { View, Text, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import { useBuddiesStore } from "@/store/buddies";
import { useMessagesStore } from "@/store/messages";
import { ChatBubble } from "@/components/ChatBubble";
import { ChatInputBar } from "@/components/ChatInputBar";
import { Avatar } from "@/components/Avatar";

export default function ChatScreen() {
  const { color } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const buddy = useBuddiesStore((s) => s.buddies.find((b) => b.id === id));
  const messages = useMessagesStore((s) => (id ? s.byBuddy[id] ?? [] : []));
  const send = useMessagesStore((s) => s.send);
  const listRef = useRef<FlatList>(null);

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
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.body }}>
            존재하지 않는 버디입니다.
          </Text>
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
                <Text
                  style={{
                    color: color("text-primary"),
                    fontWeight: "600",
                    fontSize: fontSize["title-sm"],
                  }}
                >
                  {buddy.displayName}
                </Text>
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
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <ChatBubble message={item} />}
          ListEmptyComponent={() => (
            <View style={{ padding: space[6], alignItems: "center" }}>
              <View
                style={{
                  backgroundColor: color("surface-elevated"),
                  paddingHorizontal: space[4],
                  paddingVertical: space[3],
                  borderRadius: radius.lg,
                }}
              >
                <Text style={{ color: color("text-secondary"), fontSize: fontSize["body-sm"] }}>
                  대화가 비어 있어요. 메시지를 보내 시작해 보세요.
                </Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingVertical: space[3], flexGrow: 1 }}
        />

        <ChatInputBar
          onSend={(text) => send(id, text)}
          placeholder={buddy.connected ? "메시지 보내기" : "오프라인 — 연결되면 전송됩니다"}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
