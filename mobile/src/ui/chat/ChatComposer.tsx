import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, TextInput, View, Platform } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space, touch } from '@/ui/theme/tokens';

type Props = {
  draft: string;
  placeholder: string;
  sending: boolean;
  attaching: boolean;
  pendingAttachments?: PendingChatAttachmentPreview[];
  bottomInset: number;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onOpenAttachMenu: () => void;
  onRemovePendingAttachment?: (index: number) => void;
  onLayoutHeight: (height: number) => void;
};

export type PendingChatAttachmentPreview =
  | {
      type: 'file';
      file: {
        kind: string;
        uri: string;
        name: string;
        mime: string;
        size?: number;
      };
    }
  | { type: 'location'; url: string };

export function ChatComposer({
  draft,
  placeholder,
  sending,
  attaching,
  pendingAttachments = [],
  bottomInset,
  onDraftChange,
  onSend,
  onOpenAttachMenu,
  onRemovePendingAttachment,
  onLayoutHeight,
}: Props) {
  const { color } = useTheme();
  const canSend = (!!draft.trim() || pendingAttachments.length > 0) && !sending;

  return (
    <View
      onLayout={(event) => onLayoutHeight(event.nativeEvent.layout.height)}
      style={{
        paddingHorizontal: space[3],
        paddingTop: space[2],
        paddingBottom: space[2],
        borderTopWidth: 1,
        borderTopColor: color('border'),
        backgroundColor: color('surface'),
        gap: space[2],
        ...(Platform.OS === 'android'
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: bottomInset,
            }
          : null),
      }}
    >
      {pendingAttachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space[2], paddingRight: space[1] }}
        >
          {pendingAttachments.map((attachment, index) => (
            <View
              key={`${pendingAttachmentLabel(attachment)}-${index}`}
              style={{
                width: 68,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: color('border'),
                  backgroundColor: color('surface-elevated'),
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {attachment.type === 'file' && attachment.file.kind === 'image' ? (
                  <Image
                    source={{ uri: attachment.file.uri }}
                    style={{ width: 64, height: 64 }}
                    contentFit="cover"
                  />
                ) : (
                  <Text style={{ color: color('text-primary'), fontSize: fontSize['title-md'] }}>
                    {pendingAttachmentIcon(attachment)}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => onRemovePendingAttachment?.(index)}
                accessibilityRole="button"
                accessibilityLabel={`${pendingAttachmentLabel(attachment)} 첨부 제거`}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -2,
                  width: 22,
                  height: 22,
                  borderRadius: radius.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: color('surface'),
                  borderWidth: 1,
                  borderColor: color('border'),
                }}
              >
                <Text style={{ color: color('text-secondary'), fontSize: fontSize.body, fontWeight: '700' }}>×</Text>
              </Pressable>
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{
                  color: color('text-secondary'),
                  fontSize: fontSize.caption - 2,
                  marginTop: space[1],
                  width: 64,
                }}
              >
                {pendingAttachmentLabel(attachment)}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
        <Pressable
          onPress={onOpenAttachMenu}
          disabled={attaching}
          accessibilityRole="button"
          accessibilityLabel="첨부"
          style={{
            width: touch.min,
            height: touch.min,
            borderRadius: radius.full,
            backgroundColor: color('surface-elevated'),
            alignItems: 'center',
            justifyContent: 'center',
            opacity: attaching ? 0.6 : 1,
          }}
        >
          <Text style={{ color: color('text-primary'), fontSize: fontSize['title-sm'] }}>＋</Text>
        </Pressable>

        <View
          style={{
            flex: 1,
            minHeight: touch.min,
            maxHeight: 96,
            backgroundColor: color('surface-elevated'),
            borderRadius: radius.xl,
            paddingHorizontal: space[3],
            paddingVertical: 0,
            borderWidth: 1,
            borderColor: pendingAttachments.length ? color('primary') : color('border'),
            justifyContent: 'center',
          }}
        >
          <TextInput
            value={draft}
            onChangeText={onDraftChange}
            placeholder={pendingAttachments.length ? '설명 추가 (선택)' : placeholder}
            placeholderTextColor={color('text-secondary')}
            multiline
            style={{
              fontSize: fontSize.body,
              color: color('text-primary'),
              maxHeight: 94,
              minHeight: touch.min - 2,
              paddingVertical: 0,
              includeFontPadding: false,
            }}
            editable
            selectTextOnFocus={false}
            textAlignVertical="center"
            returnKeyType="send"
            blurOnSubmit={false}
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={pendingAttachments.length ? '첨부 보내기' : '메시지 보내기'}
          style={{
            minWidth: touch.min,
            minHeight: touch.min,
            borderRadius: radius.full,
            backgroundColor: canSend ? color('primary') : color('border'),
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space[3],
          }}
        >
          <Text style={{ color: color('on-primary'), fontWeight: '700', fontSize: fontSize.body }}>
            전송
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function pendingAttachmentLabel(attachment: PendingChatAttachmentPreview): string {
  if (attachment.type === 'location') return '내 위치';
  return attachment.file.name;
}

function pendingAttachmentIcon(attachment: PendingChatAttachmentPreview): string {
  if (attachment.type === 'location') return '위치';
  if (attachment.file.kind === 'video' || attachment.file.mime.startsWith('video/')) return '영상';
  if (
    attachment.file.kind === 'audio' ||
    attachment.file.kind === 'voice' ||
    attachment.file.mime.startsWith('audio/')
  ) {
    return '음성';
  }
  return '파일';
}
