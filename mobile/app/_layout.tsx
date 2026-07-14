import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { useAuthStore } from '@/application/stores/auth';
import { useNotificationsStore } from '@/application/stores/notifications';
import { loadRuntimeConfig } from '@/infrastructure/config';
import { type NotifData, pushClient } from '@/infrastructure/notifications/pushClient';
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
  const router = useRouter();
  const segments = useSegments();
  const coldStartHandled = useRef(false);
  const [pendingPushTarget, setPendingPushTarget] = useState<string | null>(null);

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

  // Push tap → land in the corresponding chat room. Split into capture + navigate
  // so a cold-start tap is not lost: on cold start getLastResponseData() can
  // resolve BEFORE the root navigator mounts, and calling router.push() then
  // throws "navigate before mounting the Root Layout" — which the old .catch()
  // swallowed, dropping the deep link (warm taps worked only because the root was
  // already mounted). We instead stash the target and navigate once we've settled
  // into the (main) group (which also avoids the protected-route redirect to
  // /(main)/buddies clobbering the push).
  useEffect(() => {
    if (!runtimeReady || authStatus !== 'auth') return;

    const capture = (data: NotifData | null) => {
      const target = data?.buddyId ?? (data?.chatId != null ? String(data.chatId) : null);
      if (target) setPendingPushTarget(target);
    };

    // Cold start: the tap that launched the app (consume once per session).
    if (!coldStartHandled.current) {
      coldStartHandled.current = true;
      void pushClient.getLastResponseData().then(capture).catch(() => undefined);
    }

    // Warm: a tap while the app is already running.
    return pushClient.addResponseListener(capture);
  }, [runtimeReady, authStatus]);

  useEffect(() => {
    if (!pendingPushTarget || authStatus !== 'auth' || segments[0] !== '(main)') return;
    // navigate, not push: tapping a notification for the room already on screen
    // must not stack a duplicate chat screen (push always stacks; navigate
    // dedupes the same route+params and retargets params for a different room).
    router.navigate(`/chat/${pendingPushTarget}`);
    setPendingPushTarget(null);
  }, [pendingPushTarget, authStatus, segments, router]);

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
