import { useState } from "react";
import { View, TextInput, Pressable, Text } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";

export function ChatInputBar({
  onSend,
  placeholder = "메시지 보내기",
}: {
  onSend: (text: string) => void;
  placeholder?: string;
}) {
  const { color } = useTheme();
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  const canSend = value.trim().length > 0;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: space[2],
        paddingHorizontal: space[3],
        paddingTop: space[2],
        paddingBottom: space[3],
        backgroundColor: color("surface"),
        borderTopWidth: 1,
        borderTopColor: color("border"),
      }}
    >
      <Pressable
        onPress={() => {
          /* mock: voice overlay (O-01) — not in P0 */
        }}
        accessibilityRole="button"
        accessibilityLabel="음성 입력 (mock)"
        style={{
          width: touch.min,
          height: touch.min,
          borderRadius: radius.full,
          backgroundColor: color("surface-elevated"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: fontSize["title-sm"] }}>🎙️</Text>
      </Pressable>

      <View
        style={{
          flex: 1,
          backgroundColor: color("surface-elevated"),
          borderRadius: radius.xl,
          paddingHorizontal: space[4],
          paddingVertical: space[2],
          minHeight: touch.min,
          justifyContent: "center",
        }}
      >
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={color("text-secondary")}
          multiline
          style={{
            color: color("text-primary"),
            fontSize: fontSize.body,
            paddingVertical: 0,
            maxHeight: 120,
          }}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
      </View>

      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="전송"
        style={{
          width: touch.min,
          height: touch.min,
          borderRadius: radius.full,
          backgroundColor: color(canSend ? "primary" : "surface-elevated"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: color(canSend ? "on-primary" : "text-disabled"),
            fontSize: fontSize["title-sm"],
            fontWeight: "700",
          }}
        >
          ↑
        </Text>
      </Pressable>
    </View>
  );
}
