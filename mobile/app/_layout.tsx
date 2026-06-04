import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { useAuthStore } from '@/application/stores/auth';
import { loadRuntimeConfig } from '@/infrastructure/config';
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
  const { color, mode } = useTheme();
  useProtectedRoute();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color('surface') } }}>
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
    void (async () => {
      await loadRuntimeConfig();
      await bootstrap();
      initChatRuntime();
      initNetworkRuntime();
    })();
  }, [bootstrap]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0B0E14' }}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#0B0E14' }}>
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
