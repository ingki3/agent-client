import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/design/theme";
import { useAuthStore } from "@/application/stores/auth";
import { useNotificationsStore } from "@/application/stores/notifications";
import { useChatStore } from "@/application/stores/chat";
import { useBuddiesStore } from "@/application/stores/buddies";
import { pushClient, type NotifData } from "@/infrastructure/notifications/pushClient";
import { pushEnabled } from "@/infrastructure/config";

function StackWithTheme() {
  const { color, mode } = useTheme();
  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color("surface") },
          headerTintColor: color("text-primary"),
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: color("surface") },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/phone" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/code" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/twofa" options={{ headerShown: false }} />
        <Stack.Screen name="(main)/buddies" options={{ title: "친구" }} />
        <Stack.Screen name="(main)/chat/[id]" options={{ title: "채팅" }} />
        <Stack.Screen name="(main)/add-buddy/token" options={{ title: "친구 추가" }} />
        <Stack.Screen name="(main)/add-buddy/preview" options={{ title: "미리보기" }} />
        <Stack.Screen name="(main)/settings/index" options={{ title: "설정" }} />
        <Stack.Screen name="(main)/settings/about" options={{ title: "정보" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const status = useAuthStore((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Acquire/refresh the Expo push token once ready (no-op without a relay).
  useEffect(() => {
    if (status === "ready" && pushEnabled) void useNotificationsStore.getState().refresh();
  }, [status]);

  // Push listeners: foreground → ingest into the store; tap → deep-link to the chat.
  useEffect(() => {
    if (!pushEnabled) return;

    const buddyIdFor = (data: NotifData): string | undefined => {
      if (data.buddyId) return data.buddyId;
      if (data.chatId == null) return undefined;
      return useBuddiesStore.getState().buddies.find((b) => b.chatId === data.chatId)?.id;
    };

    const offForeground = pushClient.addForegroundListener((data) => {
      const id = buddyIdFor(data);
      // Content is authoritative via relay pull; trigger a catch-up for the buddy.
      if (id) void useChatStore.getState().catchUp(id);
    });

    const offResponse = pushClient.addResponseListener((data) => {
      const id = buddyIdFor(data);
      if (id) router.push(`/chat/${id}`);
    });

    // Cold-start: app launched by tapping a notification.
    void pushClient.getLastResponseData().then((data) => {
      if (!data) return;
      const id = buddyIdFor(data);
      if (id) router.push(`/chat/${id}`);
    });

    return () => {
      offForeground();
      offResponse();
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StackWithTheme />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
