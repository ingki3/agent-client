/**
 * Chat bubble (FR-11~15, FR-17). User text is rendered plain; agent text goes through
 * the GFM markdown renderer with the safe-incremental policy while streaming. The
 * trace panel (I-01) is attached under agent messages that carry a trace.
 */
import { View, Text, Pressable, Image, Linking } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import type { Attachment, LinkPreview as LinkPreviewType, Message, MessageStatus } from "@/domain/entities";
import { Markdown } from "@/ui/markdown/Markdown";
import { TracePanel } from "@/ui/components/TracePanel";
import { AgentWorkCards } from "./AgentWorkCards";
import { HelperActionCards } from "./HelperActionCards";
import { MessageTtsControls } from "./MessageTtsControls";
import { InlineKeyboardPanel } from "./InlineKeyboardPanel";

function fmtDuration(ms?: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Renders an attachment inside a bubble: image inline, others as a tappable file chip. */
function AttachmentView({ a, tint }: { a: Attachment; tint: string }) {
  const { color } = useTheme();
  if (a.kind === "image") {
    return (
      <Image source={{ uri: a.uri }} style={{ width: 220, height: 220, borderRadius: radius.md }} resizeMode="cover" />
    );
  }
  const icon = a.kind === "video" ? "🎬" : a.kind === "voice" ? "🎙️" : a.kind === "audio" ? "🎵" : "📄";
  const sub = a.kind === "voice" || a.kind === "video" ? fmtDuration(a.durationMs) : fmtSize(a.size);
  return (
    <Pressable
      onPress={() => void Linking.openURL(a.uri).catch(() => undefined)}
      style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1], minWidth: 180 }}
    >
      <Text style={{ fontSize: fontSize["title-md"] }}>{icon}</Text>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: tint, fontSize: fontSize["body-sm"], fontWeight: "600" }} numberOfLines={1}>
          {a.name}
        </Text>
        {sub ? <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] ?? url;
}

function hasVisibleUrl(message: Message): boolean {
  return /https?:\/\/[^\s)\]}>"']+/i.test(message.text) || /\]\(https?:\/\/[^)\s]+\)/i.test(message.text);
}

/** Telegram-style link card: optional cover image, site, title, description, host. */
function LinkPreview({ preview }: { preview: LinkPreviewType }) {
  const { color } = useTheme();
  return (
    <Pressable
      onPress={() => void Linking.openURL(preview.url).catch(() => undefined)}
      style={{
        marginTop: space[2],
        borderRadius: radius.md,
        overflow: "hidden",
        backgroundColor: color("surface-elevated"),
        borderLeftWidth: 3,
        borderLeftColor: color("primary"),
      }}
    >
      {preview.image ? (
        <Image source={{ uri: preview.image }} style={{ width: "100%", height: 160 }} resizeMode="cover" />
      ) : null}
      <View style={{ paddingHorizontal: space[3], paddingVertical: space[2], gap: 2 }}>
        {preview.siteName ? (
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>{preview.siteName}</Text>
        ) : null}
        {preview.title ? (
          <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "700" }} numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }} numberOfLines={3}>
            {preview.description}
          </Text>
        ) : null}
        <Text style={{ color: color("primary"), fontSize: fontSize.caption }} numberOfLines={1}>
          {hostOf(preview.url)}
        </Text>
      </View>
    </Pressable>
  );
}

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
        // Speaker is already conveyed by side + bubble color, so use equal, narrow side
        // margins and let bubbles grow wide for readability (long messages fill the row).
        paddingHorizontal: space[3],
        paddingVertical: space[1],
      }}
    >
      <View style={{ maxWidth: "100%" }}>
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
          {message.replyTo ? (
            <View
              style={{
                borderLeftWidth: 3,
                borderLeftColor: color(isUser ? "on-user-bubble" : "primary"),
                paddingLeft: space[2],
                marginBottom: space[1],
                opacity: 0.85,
              }}
            >
              <Text numberOfLines={2} style={{ color: bubbleTextColor, fontSize: fontSize.caption }}>
                {message.replyTo.text}
              </Text>
            </View>
          ) : null}
          {message.attachments?.length ? (
            <View style={{ marginBottom: message.text.length > 0 ? space[2] : 0, gap: space[1] }}>
              {message.attachments.length > 1 && message.attachments.every((a) => a.kind === "image") ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1], width: 222 }}>
                  {message.attachments.map((a, i) => (
                    <Image key={i} source={{ uri: a.uri }} style={{ width: 108, height: 108, borderRadius: radius.sm }} resizeMode="cover" />
                  ))}
                </View>
              ) : (
                message.attachments.map((a, i) => <AttachmentView key={i} a={a} tint={bubbleTextColor} />)
              )}
            </View>
          ) : null}
          {message.text.length > 0 ? (
            isUser ? (
              <Text style={{ color: bubbleTextColor, fontSize: fontSize.body, lineHeight: fontSize.body * 1.45 }} selectable>
                {message.text}
              </Text>
            ) : (
              <View style={{ width: "100%" }}>
                <Markdown text={message.text} baseColor={bubbleTextColor} streaming={isStreaming} />
                {isStreaming ? <Text style={{ color: bubbleTextColor, fontSize: fontSize.body }}>▍</Text> : null}
              </View>
            )
          ) : !message.attachments?.length && isStreaming ? (
            <Text style={{ color: bubbleTextColor, fontSize: fontSize.body }}>● ● ●</Text>
          ) : null}
        </Pressable>

        {message.preview && hasVisibleUrl(message) ? <LinkPreview preview={message.preview} /> : null}

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
        {!isUser ? <AgentWorkCards message={message} /> : null}
        {!isUser ? <MessageTtsControls message={message} /> : null}
        {!isUser ? <InlineKeyboardPanel message={message} /> : null}
        {!isUser ? <HelperActionCards message={message} /> : null}
      </View>
    </View>
  );
}
