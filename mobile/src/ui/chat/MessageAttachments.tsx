import { Linking, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import type { Message } from '@/domain/entities/Message';

import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

function formatBytes(size?: number): string | null {
  if (size == null || !Number.isFinite(size)) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachments({ message }: { message: Message }) {
  const attachments = message.attachments ?? [];
  const { color } = useTheme();
  if (!attachments.length) return null;
  return (
    <View style={{ marginTop: message.text.trim() ? space[2] : 0, gap: space[2] }}>
      {attachments.map((attachment, index) => {
        const key = `${attachment.uri}-${index}`;
        const size = formatBytes(attachment.size);
        const isImage = attachment.kind === 'image' || attachment.mime.startsWith('image/');
        if (isImage) {
          return (
            <Pressable
              key={key}
              onPress={() => void Linking.openURL(attachment.uri).catch(() => undefined)}
              style={{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: color('border') }}
            >
              <Image
                source={{ uri: attachment.uri }}
                style={{ width: '100%', aspectRatio: 4 / 3 }}
                contentFit="cover"
              />
            </Pressable>
          );
        }
        return (
          <Pressable
            key={key}
            onPress={() => void Linking.openURL(attachment.uri).catch(() => undefined)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color('border'),
              backgroundColor: color('surface-elevated'),
              paddingHorizontal: space[3],
              paddingVertical: space[2],
            }}
          >
            <Text style={{ fontSize: fontSize['title-sm'] }}>📎</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }} numberOfLines={1}>
                {attachment.name}
              </Text>
              <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption }} numberOfLines={1}>
                {[attachment.mime, size].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
