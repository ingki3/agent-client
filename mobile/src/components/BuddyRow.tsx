import { View, Text, Pressable } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import type { Buddy } from "@/domain/entities";
import { Avatar } from "./Avatar";
import { UnreadBadge } from "./Badge";

function formatRelative(iso: string) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((now - t) / 60000));
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}일 전`;
}

export function BuddyRow({
  buddy,
  onPress,
  onLongPress,
  variant = "inbox",
}: {
  buddy: Buddy;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: "inbox" | "list";
}) {
  const { color } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${buddy.displayName} 채팅 열기`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        backgroundColor: pressed ? color("surface-elevated") : color("surface"),
      })}
    >
      <Avatar name={buddy.displayName} accent={buddy.accent} size={48} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: space[2],
          }}
        >
          <Text
            style={{
              color: color("text-primary"),
              fontSize: fontSize["title-sm"],
              fontWeight: "600",
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {buddy.displayName}
          </Text>
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
            {formatRelative(buddy.lastMessageAt)}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: space[2],
            marginTop: space[1],
          }}
        >
          <Text
            style={{
              color: color("text-secondary"),
              fontSize: fontSize["body-sm"],
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {buddy.lastMessagePreview}
          </Text>
          <UnreadBadge count={buddy.unread} />
        </View>

        {variant === "list" ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[2],
              marginTop: space[2],
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: radius.full,
                backgroundColor: color(buddy.connected ? "success" : "offline"),
              }}
            />
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
              {buddy.connected ? "연결됨" : "연결 안 됨"} · {buddy.handle}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
