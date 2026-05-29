/**
 * Chat bubble (FR-11~15, FR-17). User text is rendered plain; agent text goes through
 * the GFM markdown renderer with the safe-incremental policy while streaming. The
 * trace panel (I-01) is attached under agent messages that carry a trace.
 */
import { View, Text, Pressable } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import type { Message, MessageStatus } from "@/domain/entities";
import { Markdown } from "@/ui/markdown/Markdown";
import { TracePanel } from "@/ui/components/TracePanel";

const STATUS_LABEL: Record<MessageStatus, string> = {
  sending: "보내는 중",
  sent: "보냄",
  streaming: "응답 중",
  done: "",
  failed: "⚠ 실패",
  "queued-offline": "오프라인 대기",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ChatBubble({ message, onLongPress }: { message: Message; onLongPress?: () => void }) {
  const { color } = useTheme();
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isStreaming = message.status === "streaming";

  if (isSystem) {
    return (
      <View style={{ paddingVertical: space[3], alignItems: "center" }}>
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{message.text}</Text>
      </View>
    );
  }

  const bubbleTextColor = color(isUser ? "on-user-bubble" : "on-agent-bubble");
  const statusLabel = message.status ? STATUS_LABEL[message.status] : "";

  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: isUser ? "flex-end" : "flex-start",
        paddingHorizontal: space[4],
        paddingVertical: space[1],
      }}
    >
      <View style={{ maxWidth: "82%" }}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          style={{
            backgroundColor: color(isUser ? "user-bubble" : "agent-bubble"),
            borderRadius: radius.bubble,
            paddingHorizontal: space[4],
            paddingVertical: space[3],
            borderBottomRightRadius: isUser ? radius.sm : radius.bubble,
            borderBottomLeftRadius: isUser ? radius.bubble : radius.sm,
          }}
        >
          {isUser ? (
            <Text style={{ color: bubbleTextColor, fontSize: fontSize.body, lineHeight: fontSize.body * 1.45 }} selectable>
              {message.text}
            </Text>
          ) : message.text.length === 0 && isStreaming ? (
            <Text style={{ color: bubbleTextColor, fontSize: fontSize.body }}>● ● ●</Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
              <View style={{ flexShrink: 1 }}>
                <Markdown text={message.text} baseColor={bubbleTextColor} streaming={isStreaming} />
              </View>
              {isStreaming ? <Text style={{ color: bubbleTextColor, fontSize: fontSize.body }}>▍</Text> : null}
            </View>
          )}
        </Pressable>

        <View
          style={{
            flexDirection: "row",
            justifyContent: isUser ? "flex-end" : "flex-start",
            gap: space[1],
            marginTop: space[1],
            paddingHorizontal: space[1],
          }}
        >
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{formatTime(message.createdAt)}</Text>
          {statusLabel ? (
            <Text
              style={{
                color: message.status === "failed" ? color("error") : color("text-secondary"),
                fontSize: fontSize.caption,
              }}
            >
              · {statusLabel}
            </Text>
          ) : null}
        </View>

        {!isUser && message.traceId ? <TracePanel messageId={message.id} streaming={isStreaming} /> : null}
      </View>
    </View>
  );
}
