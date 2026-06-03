/**
 * Splash — root entry, decides whether to route to `(auth)` or `(main)` once
 * the persisted auth token has been hydrated (UC-01).
 *
 * BIZ-268 foundation only renders the visual splash; the branch logic ships
 * with M1 sub 2 (BIZ-270) once `useAuthStore.hydrateFromSecureStore()` and
 * `SecureTokenStore` exist. Until then the screen stays mounted so that
 * `(auth)` / `(main)` can be navigated to manually for QA — see PR #7.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, space } from '@/ui/theme/tokens';

export default function SplashScreen() {
  const { color } = useTheme();
  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: color('surface') }]}
      accessibilityLabel="Splash"
    >
      <View style={styles.center}>
        <Text style={[styles.brand, { color: color('text-primary') }]}>Agent Client</Text>
        <Text style={[styles.tagline, { color: color('text-secondary') }]}>
          내 손 위의 비서, 친구처럼.
        </Text>
        <ActivityIndicator
          style={{ marginTop: space[6] }}
          color={color('primary')}
          accessibilityLabel="loading"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[6] },
  brand: { fontSize: fontSize['title-xl'], fontWeight: '700', letterSpacing: 0.2 },
  tagline: { fontSize: fontSize.body, marginTop: space[2], textAlign: 'center' },
});
