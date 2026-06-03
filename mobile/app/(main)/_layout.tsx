/**
 * Main route group — buddies (S-10/S-11) / chat (S-11) / add-buddy (M-01) /
 * settings (S-20/S-21) ship across M1 sub 4–7. Foundation declares the
 * empty stack so Splash can route to `(main)` once auth hydrates.
 *
 * BIZ-230 mockup screens (inbox/buddies/chat/add-buddy) live under this
 * group until the real screens replace them in their respective sub-issues.
 */
import { Stack } from 'expo-router';

import { useTheme } from '@/ui/theme/ThemeProvider';

export default function MainLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color('surface') },
        headerTintColor: color('text-primary'),
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: color('surface') },
      }}
    />
  );
}
