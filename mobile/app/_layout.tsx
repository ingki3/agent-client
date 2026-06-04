import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { useAuthStore } from '@/application/stores/auth';
import { computeProtectedRoute } from '@/ui/navigation/protected-route';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

import { initChatRuntime } from './_runtime/chat';
import { initNetworkRuntime } from './_runtime/network';

function useProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const target = computeProtectedRoute(status, segments);
    if (target !== null) router.replace(target);
  }, [status, segments, router]);
}

function RootStack() {
  const { mode } = useTheme();
  useProtectedRoute();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
    initChatRuntime();
    initNetworkRuntime();
  }, [bootstrap]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
