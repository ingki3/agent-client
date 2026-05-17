import { View, Text } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";

export function UnreadBadge({ count }: { count: number }) {
  const { color } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: space[2],
        borderRadius: radius.full,
        backgroundColor: color("primary"),
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityLabel={`읽지 않은 메시지 ${count}건`}
    >
      <Text
        style={{
          color: color("on-primary"),
          fontSize: fontSize.caption,
          fontWeight: "700",
        }}
      >
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}
