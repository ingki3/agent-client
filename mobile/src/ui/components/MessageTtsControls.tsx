import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import type { Message, TtsMode } from "@/domain/entities";
import { useChatStore } from "@/application/stores/chat";

let activeSound: Audio.Sound | null = null;
let activeMessage: { buddyId: string; messageId: string } | null = null;

const MODES: Array<{ mode: TtsMode; label: string }> = [
  { mode: "brief", label: "요약" },
  { mode: "explain", label: "대화형" },
  { mode: "action_items", label: "다음 액션" },
];

function sameMessage(message: Message): boolean {
  return activeMessage?.buddyId === message.buddyId && activeMessage.messageId === message.id;
}

function markReadyForActive() {
  const key = activeMessage;
  if (!key) return;
  const store = useChatStore.getState();
  const msg = store.byBuddy[key.buddyId]?.find((m) => m.id === key.messageId);
  if (msg?.tts) store.setMessageTts(key.buddyId, key.messageId, { ...msg.tts, status: "ready" });
}

async function stopActive(markReady: boolean) {
  const sound = activeSound;
  if (markReady) markReadyForActive();
  activeSound = null;
  activeMessage = null;
  if (!sound) return;
  await sound.stopAsync().catch(() => undefined);
  await sound.unloadAsync().catch(() => undefined);
}

export function MessageTtsControls({ message }: { message: Message }) {
  const { color } = useTheme();
  const prepareTts = useChatStore((s) => s.prepareTts);
  const setMessageTts = useChatStore((s) => s.setMessageTts);
  const [busyMode, setBusyMode] = useState<TtsMode | null>(null);

  if (message.role !== "agent" || message.status !== "done" || !message.text.trim()) return null;

  const tts = message.tts;
  const isGenerating = tts?.status === "generating";
  const isPlaying = tts?.status === "playing" && sameMessage(message);

  const play = async (mode: TtsMode) => {
    if (isPlaying && tts?.mode === mode) {
      await stopActive(true);
      return;
    }
    setBusyMode(mode);
    try {
      await stopActive(true);
      const prepared = await prepareTts(message.buddyId, message.id, mode);
      if (!prepared) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: prepared.audioUrl }, { shouldPlay: true });
      activeSound = sound;
      activeMessage = { buddyId: message.buddyId, messageId: message.id };
      setMessageTts(message.buddyId, message.id, {
        status: "playing",
        mode: prepared.mode,
        audioUrl: prepared.audioUrl,
        script: prepared.script,
      });
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          void stopActive(false);
          setMessageTts(message.buddyId, message.id, {
            status: "ready",
            mode: prepared.mode,
            audioUrl: prepared.audioUrl,
            script: prepared.script,
          });
        }
      });
    } catch {
      await stopActive(false);
      setMessageTts(message.buddyId, message.id, {
        status: "failed",
        mode,
        audioUrl: tts?.audioUrl,
        script: tts?.script,
        error: "음성 재생에 실패했습니다.",
      });
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <View style={{ paddingHorizontal: space[1], paddingTop: space[1], gap: space[1] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Pressable
          onPress={() => void play(tts?.mode ?? "brief")}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "음성 중지" : "음성 듣기"}
          disabled={isGenerating || busyMode !== null}
          style={({ pressed }) => ({
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: color("border-strong"),
            backgroundColor: pressed ? color("surface-overlay") : color("surface-elevated"),
            paddingHorizontal: space[3],
            paddingVertical: space[2],
            opacity: isGenerating || busyMode !== null ? 0.7 : 1,
          })}
        >
          <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }}>
            {isGenerating || busyMode ? "음성 준비 중" : isPlaying ? "■ 중지" : "▶ 듣기"}
          </Text>
        </Pressable>
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
                borderColor: selected ? color("primary") : color("border"),
                backgroundColor: selected ? color("trace-summary") : pressed ? color("surface-overlay") : color("surface-elevated"),
                paddingHorizontal: space[3],
                paddingVertical: space[2],
                opacity: isGenerating || busyMode !== null ? 0.7 : 1,
              })}
            >
              <Text style={{ color: selected ? color("on-trace-summary") : color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "600" }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tts?.status === "failed" && tts.error ? (
        <Text style={{ color: color("error"), fontSize: fontSize.caption }}>{tts.error}</Text>
      ) : null}
    </View>
  );
}
