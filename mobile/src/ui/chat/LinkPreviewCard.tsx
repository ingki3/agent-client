import { Linking, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import type { Message } from '@/domain/entities/Message';

import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

export function LinkPreviewCard({ message }: { message: Message }) {
  const preview = message.preview;
  const { color } = useTheme();
  if (!preview?.url && !preview?.title) return null;
  return (
    <Pressable
      onPress={() => preview.url ? void Linking.openURL(preview.url).catch(() => undefined) : undefined}
      style={{
        marginTop: space[2],
        borderRadius: radius.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: color('border'),
        backgroundColor: color('surface-elevated'),
      }}
    >
      {preview.image ? (
        <Image
          source={{ uri: preview.image }}
          style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: color('border') }}
          contentFit="cover"
        />
      ) : null}
      <View style={{ padding: space[3], gap: space[1] }}>
        {preview.siteName ? (
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }}>{preview.siteName}</Text>
        ) : null}
        {preview.title ? (
          <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }} numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }} numberOfLines={3}>
            {preview.description}
          </Text>
        ) : null}
        {preview.url ? (
          <Text style={{ color: color('primary'), fontSize: fontSize.caption }} numberOfLines={1}>
            {preview.url.replace(/^https?:\/\//, '')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
