import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { useAuthStore } from '@/application/stores/auth';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

function useProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'initializing') return;
    const inAuthGroup = segments[0] === '(auth)';
    if (status === 'auth' && inAuthGroup) {
      router.replace('/(main)/buddies');
    } else if (status !== 'auth' && !inAuthGroup) {
      // guest or awaiting_code → must be in (auth) flow
      router.replace('/(auth)/phone');
    }
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
