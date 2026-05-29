import { View, Text, type ViewStyle } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius } from "@/design/tokens";
import type { AccentSlot } from "@/domain/entities";

export function Avatar({
  name,
  accent,
  size = 40,
  style,
}: {
  name: string;
  accent: AccentSlot;
  size?: number;
  style?: ViewStyle;
}) {
  const { color } = useTheme();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.full,
          backgroundColor: color(accent),
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={`${name} 아이콘`}
    >
      <Text
        style={{
          color: color("on-primary"),
          fontWeight: "700",
          fontSize: size >= 40 ? fontSize["title-sm"] : fontSize["body-sm"],
        }}
      >
        {initials || "?"}
      </Text>
    </View>
  );
}
