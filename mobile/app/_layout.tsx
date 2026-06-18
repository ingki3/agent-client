import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { useAuthStore } from '@/application/stores/auth';
import { useNotificationsStore } from '@/application/stores/notifications';
import { loadRuntimeConfig } from '@/infrastructure/config';
import { computeProtectedRoute } from '@/ui/navigation/protected-route';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

import { initBuddiesRuntime, syncRelayPeersToLocal } from './_runtime/buddies';
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
  const authStatus = useAuthStore((s) => s.status);
  const [runtimeReady, setRuntimeReady] = useState(false);

  useEffect(() => {
    void (async () => {
      console.log('[runtime] bootstrap start');
      await loadRuntimeConfig();
      await bootstrap();
      initBuddiesRuntime();
      initChatRuntime();
      initNetworkRuntime();
      console.log('[runtime] bootstrap complete');
      setRuntimeReady(true);
    })().catch((error) => {
      console.warn('[runtime] bootstrap failed', error);
      setRuntimeReady(true);
    });
  }, [bootstrap]);

  useEffect(() => {
    if (!runtimeReady || authStatus !== 'auth') return;
    void (async () => {
      console.log('[runtime] auth ready; syncing peers and refreshing push registration');
      await syncRelayPeersToLocal().catch((error) => {
        console.warn('[runtime] peer sync failed', error);
      });
      await useNotificationsStore.getState().refresh().catch((error) => {
        console.warn('[runtime] push refresh failed', error);
      });
    })();
  }, [authStatus, runtimeReady]);

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
