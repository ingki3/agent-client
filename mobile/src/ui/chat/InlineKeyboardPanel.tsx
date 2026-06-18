import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { useChatStore } from '@/application/stores/chat-store';
import type { InlineKeyboardButton, Message } from '@/domain/entities/Message';
import { relayClient } from '@/infrastructure/api/relayClient';

import { useTheme } from '../theme/ThemeProvider';
import { fontSize, radius, space } from '../theme/tokens';

import { buttonStyle, tgMessageId } from './chatMessageUtils';

function buttonColors(style: InlineKeyboardButton['style'], color: ReturnType<typeof useTheme>['color']) {
  if (style === 'success') return { bg: color('trace-summary'), fg: color('on-trace-summary'), border: color('primary') };
  if (style === 'danger') return { bg: color('surface-elevated'), fg: color('error'), border: color('border-strong') };
  if (style === 'primary') return { bg: color('primary'), fg: color('on-primary'), border: color('primary') };
  return { bg: color('surface-elevated'), fg: color('text-primary'), border: color('border') };
}

export function InlineKeyboardPanel({ message }: { message: Message }) {
  const keyboard = message.inlineKeyboard;
  const { color } = useTheme();
  const [loading, setLoading] = useState<string | null>(null);
  const appendMessage = useChatStore((s) => s.appendMessage);
  if (!keyboard?.rows.length) return null;

  const appendSystem = (text: string) => appendMessage({
    id: null,
    clientMessageId: `sys-${Date.now()}`,
    buddyId: message.buddyId,
    role: 'system',
    text,
    status: 'sent',
    createdAt: Date.now(),
    traceId: null,
  });

  const onPress = async (button: InlineKeyboardButton) => {
    if (button.disabled || loading) return;
    if (button.url && (button.type === 'url' || button.type === 'web_app' || button.type === 'login_url')) {
      await Linking.openURL(button.url).catch(() => appendSystem('링크를 열 수 없습니다.'));
      return;
    }
    if (button.type !== 'callback') {
      appendSystem('이 버튼 형식은 아직 지원하지 않습니다.');
      return;
    }
    const peerId = Number(message.buddyId);
    const messageId = tgMessageId(message.id);
    if (!Number.isFinite(peerId) || !messageId) {
      appendSystem('버튼 실행에 필요한 Telegram 메시지 정보를 찾지 못했습니다.');
      return;
    }
    setLoading(button.id);
    try {
      const result = await relayClient.clickInlineKeyboardButton(peerId, messageId, button.id);
      if (!result) appendSystem('버튼 실행에 실패했습니다. relay 연결을 확인해 주세요.');
      if (result?.url) await Linking.openURL(result.url).catch(() => appendSystem('응답 링크를 열 수 없습니다.'));
      if (result?.message) appendSystem(result.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={{ marginTop: space[2], gap: space[2] }}>
      {keyboard.rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: space[2] }}>
          {row.map((button) => {
            const c = buttonColors(button.style ?? buttonStyle(button.label), color);
            const busy = loading === button.id;
            return (
              <Pressable
                key={button.id}
                disabled={!!loading || !!button.disabled}
                onPress={() => void onPress(button)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 40,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? color('surface-overlay') : c.bg,
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: button.disabled ? 0.55 : 1,
                })}
              >
                <Text
                  style={{ color: c.fg, fontSize: fontSize['body-sm'], fontWeight: '700', textAlign: 'center' }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {busy ? '처리 중...' : button.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
