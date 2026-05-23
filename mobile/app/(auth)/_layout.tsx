import { Stack } from 'expo-router';
import { useTheme } from '@/ui/theme/ThemeProvider';

export default function AuthLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color('surface') },
        headerTintColor: color('text-primary'),
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: color('surface') },
      }}
    >
      <Stack.Screen name="phone" options={{ title: '로그인', headerShown: false }} />
      <Stack.Screen
        name="otp"
        options={{ title: '인증번호 입력', headerBackButtonDisplayMode: 'minimal' }}
      />
    </Stack>
  );
}
