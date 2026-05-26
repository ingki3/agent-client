/**
 * Add-buddy modal stack — S-12 (token) → S-13 (preview).
 *
 * Mounted as a modal so the back gesture pops the entire flow back to S-10
 * without leaving an orphaned half-filled token screen in the navigation
 * history (USER_FLOW §6 returning paths).
 */
import { Stack } from 'expo-router';

import { useTheme } from '@/ui/theme/ThemeProvider';

export default function AddBuddyLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        presentation: 'modal',
        headerStyle: { backgroundColor: color('surface') },
        headerTintColor: color('text-primary'),
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: color('surface') },
      }}
    >
      <Stack.Screen name="token" options={{ title: '친구 추가' }} />
      <Stack.Screen name="preview" options={{ title: '확인' }} />
    </Stack>
  );
}
