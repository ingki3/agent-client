import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';

import { useChatStore } from '@/application/stores/chat-store';
import type { Message, TtsMode } from '@/domain/entities/Message';
import { relayClient } from '@/infrastructure/api/relayClient';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { fontSize, radius, space } from '@/ui/theme/tokens';

let activeSound: Audio.Sound | null = null;
let activeMessageId: string | null = null;

const DEFAULT_VOICE = 'ko-KR-InJoonNeural';

const MODES: Array<{ mode: TtsMode; label: string }> = [
  { mode: 'brief', label: '요약' },
  { mode: 'explain', label: '대화형' },
];

function sameMessage(message: Message): boolean {
  return activeMessageId === message.clientMessageId;
}

function markReadyForActive() {
  const id = activeMessageId;
  if (!id) return;
  const store = useChatStore.getState();
  const msg = store.messages[id];
  if (!msg?.tts) return;
  store.setMessageTts(id, { ...msg.tts, status: 'ready' });
}

async function stopActive(markReady: boolean) {
  const sound = activeSound;
  if (markReady) markReadyForActive();
  activeSound = null;
  activeMessageId = null;
  if (!sound) return;
  await sound.stopAsync().catch(() => undefined);
  await sound.unloadAsync().catch(() => undefined);
}

export function MessageTtsControls({ message }: { message: Message }) {
  const { color } = useTheme();
  const setMessageTts = useChatStore((s) => s.setMessageTts);
  const [busyMode, setBusyMode] = useState<TtsMode | null>(null);

  if (message.role !== 'agent' || !message.text.trim()) return null;

  const tts = message.tts;
  const isGenerating = tts?.status === 'generating';
  const isPlaying = tts?.status === 'playing' && sameMessage(message);

  const play = async (mode: TtsMode) => {
    if (isPlaying && tts?.mode === mode) {
      await stopActive(true);
      return;
    }

    setBusyMode(mode);
    setMessageTts(message.clientMessageId, { status: 'generating', mode });
    try {
      await stopActive(true);
      const prepared = await relayClient.createTtsAudio({
        messageId: message.id ?? message.clientMessageId,
        text: message.text,
        mode,
        voice: DEFAULT_VOICE,
      });
      if (!prepared) {
        setMessageTts(message.clientMessageId, { status: 'failed', mode, error: '음성 생성에 실패했습니다.' });
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: prepared.audioUrl }, { shouldPlay: true });
      activeSound = sound;
      activeMessageId = message.clientMessageId;
      setMessageTts(message.clientMessageId, {
        status: 'playing',
        mode: prepared.mode,
        audioUrl: prepared.audioUrl,
        script: prepared.script,
      });
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          void stopActive(false);
          setMessageTts(message.clientMessageId, {
            status: 'ready',
            mode: prepared.mode,
            audioUrl: prepared.audioUrl,
            script: prepared.script,
          });
        }
      });
    } catch {
      await stopActive(false);
      setMessageTts(message.clientMessageId, {
        status: 'failed',
        mode,
        error: '음성 재생에 실패했습니다.',
      });
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <View style={{ marginTop: space[2], gap: space[2] }}>
      {/* 듣기 메뉴 — 재생/정지 진입점 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Pressable
          onPress={() => void play(tts?.mode ?? 'explain')}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? '음성 중지' : '음성 듣기'}
          disabled={isGenerating || busyMode !== null}
          style={({ pressed }) => ({
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: color('border-strong'),
            backgroundColor: pressed ? color('surface-overlay') : color('surface-elevated'),
            paddingHorizontal: space[3],
            paddingVertical: space[2],
            opacity: isGenerating || busyMode !== null ? 0.7 : 1,
          })}
        >
          <Text style={{ color: color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '700' }}>
            {isGenerating || busyMode ? '음성 준비 중' : isPlaying ? '중지' : '듣기'}
          </Text>
        </Pressable>
      </View>

      {/* 듣기 방식 — 요약 / 대화형 모드 선택 (듣기 메뉴와 구분된 그룹) */}
      <View style={{ gap: space[1] }}>
        <Text style={{ color: color('text-secondary'), fontSize: fontSize.caption, fontWeight: '600' }}>
          듣기 방식
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {MODES.map((item) => {
            const selected = tts?.mode === item.mode;
            return (
              <Pressable
                key={item.mode}
                onPress={() => void play(item.mode)}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} 듣기`}
                disabled={isGenerating || busyMode !== null}
                style={({ pressed }) => ({
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: selected ? color('primary') : color('border'),
                  backgroundColor: selected ? color('trace-summary') : pressed ? color('surface-overlay') : color('surface-elevated'),
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                  opacity: isGenerating || busyMode !== null ? 0.7 : 1,
                })}
              >
                <Text style={{ color: selected ? color('on-trace-summary') : color('text-primary'), fontSize: fontSize['body-sm'], fontWeight: '600' }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tts?.status === 'failed' && tts.error ? (
        <Text style={{ color: color('error'), fontSize: fontSize.caption }}>{tts.error}</Text>
      ) : null}
    </View>
  );
}
