/**
 * Shared primary/secondary action buttons (extracted from ChatBubbleV2 helper
 * cards; reusable by form screens).
 */
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

export function SubmitButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: radius.md,
        backgroundColor: color(disabled ? 'border' : 'primary'),
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[3],
      }}
    >
      <Text
        style={{ color: color(disabled ? 'text-disabled' : 'on-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function GhostButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color('border'),
        backgroundColor: color('surface-elevated'),
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[3],
      }}
    >
      <Text
        style={{ color: color(disabled ? 'text-disabled' : 'text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {label}
      </Text>
    </Pressable>
  );
}
