import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import type { InlineKeyboardButton, Message } from "@/domain/entities";
import { useBuddiesStore } from "@/application/stores/buddies";
import { useChatStore } from "@/application/stores/chat";
import { relayClient } from "@/infrastructure/api/relayClient";

function tgMessageId(id: string): number | undefined {
  const m = id.match(/^tg-(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

function buttonColors(style: InlineKeyboardButton["style"], color: ReturnType<typeof useTheme>["color"]) {
  if (style === "success") return { bg: color("trace-summary"), fg: color("on-trace-summary"), border: color("primary") };
  if (style === "danger") return { bg: color("surface-elevated"), fg: color("error"), border: color("border-strong") };
  if (style === "primary") return { bg: color("primary"), fg: color("on-primary"), border: color("primary") };
  return { bg: color("surface-elevated"), fg: color("text-primary"), border: color("border") };
}

function safeUrl(button: InlineKeyboardButton): string | undefined {
  if (!button.url) return undefined;
  if (button.type === "login_url" && !/^https:\/\//i.test(button.url)) return undefined;
  return button.url;
}

export function InlineKeyboardPanel({ message }: { message: Message }) {
  const keyboard = message.inlineKeyboard;
  const { color } = useTheme();
  const [loading, setLoading] = useState<string | null>(null);
  const buddy = useBuddiesStore((s) => s.buddies.find((b) => b.id === message.buddyId));
  const catchUp = useChatStore((s) => s.catchUp);
  const appendLocalSystemMessage = useChatStore((s) => s.appendLocalSystemMessage);

  if (!keyboard?.rows.length || message.role !== "agent") return null;

  const onPress = async (button: InlineKeyboardButton) => {
    if (button.disabled || loading) return;
    const url = safeUrl(button);
    if (url && (button.type === "url" || button.type === "web_app" || button.type === "login_url")) {
      await Linking.openURL(url).catch(() => appendLocalSystemMessage(message.buddyId, "링크를 열 수 없습니다."));
      return;
    }
    if (button.type === "copy") {
      await Clipboard.setStringAsync(button.copyText ?? button.label);
      appendLocalSystemMessage(message.buddyId, "버튼 텍스트를 복사했습니다.");
      return;
    }
    if (button.type !== "callback") {
      appendLocalSystemMessage(message.buddyId, "이 버튼 형식은 아직 지원하지 않습니다.");
      return;
    }
    const messageId = tgMessageId(message.id);
    if (!buddy?.botId || !messageId) {
      appendLocalSystemMessage(message.buddyId, "버튼을 실행할 Telegram 메시지 정보를 찾지 못했습니다.");
      return;
    }
    setLoading(button.id);
    try {
      const result = await relayClient.clickInlineKeyboardButton(buddy.botId, messageId, button.id);
      if (!result) {
        appendLocalSystemMessage(message.buddyId, "버튼 실행에 실패했습니다. relay 연결을 확인해 주세요.");
        return;
      }
      if (result.url) await Linking.openURL(result.url).catch(() => appendLocalSystemMessage(message.buddyId, "응답 링크를 열 수 없습니다."));
      if (result.message) appendLocalSystemMessage(message.buddyId, result.message);
      await catchUp(message.buddyId);
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={{ marginTop: space[2], gap: space[2], paddingHorizontal: space[1] }}>
      {keyboard.rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: space[2] }}>
          {row.map((button) => {
            const c = buttonColors(button.style, color);
            const disabled = !!button.disabled || !!loading;
            const busy = loading === button.id;
            const external = button.type === "url" || button.type === "web_app" || button.type === "login_url";
            return (
              <Pressable
                key={button.id}
                disabled={disabled}
                onPress={() => void onPress(button)}
                accessibilityRole="button"
                accessibilityLabel={button.label}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: touch.min,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? color("surface-overlay") : c.bg,
                  paddingHorizontal: space[3],
                  paddingVertical: space[2],
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: disabled && !busy ? 0.55 : 1,
                })}
              >
                <Text
                  style={{ color: c.fg, fontSize: fontSize["body-sm"], fontWeight: "700", textAlign: "center" }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {busy ? "처리 중..." : `${button.label}${external ? " ↗" : ""}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
