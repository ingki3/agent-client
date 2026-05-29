import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/design/theme";
import { useAuthStore } from "@/application/stores/auth";

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
        <Stack.Screen name="(auth)/otp" options={{ title: "인증 코드" }} />
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

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
