/**
 * I-01 · Trace panel + M-01 node-detail modal (UC-05, FR-17~21).
 *
 * Collapsed: one-line summary "🧠 N단계 · 🛠 M개 툴 · ⏱ t초". Expanded: thinking /
 * tool_call / tool_result nodes in sequence, with a live spinner while streaming.
 * Tapping a node opens the raw JSON (sensitive args masked via `maskArgs`).
 * Hidden entirely when there is no trace (standard-bot fallback).
 */
import { useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, Platform } from "react-native";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space, touch } from "@/design/tokens";
import { maskArgs, type TraceNode } from "@/domain/entities";
import { useTraceStore } from "@/application/stores/trace";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

function nodeIcon(node: TraceNode): string {
  if (node.kind === "thinking") return "🧠";
  if (node.kind === "tool_call") return "🛠";
  return node.payload.status === "error" ? "⚠️" : "✅";
}

function nodeTitle(node: TraceNode): string {
  if (node.kind === "thinking") return String(node.payload.summary ?? "사고 단계");
  if (node.kind === "tool_call") return String(node.payload.name ?? "도구 호출");
  return "도구 결과";
}

function maskNode(node: TraceNode): Record<string, unknown> {
  if (node.kind === "tool_call") {
    return { ...node.payload, args: maskArgs((node.payload.args as Record<string, unknown>) ?? {}) };
  }
  return node.payload;
}

export function TracePanel({ messageId, streaming }: { messageId: string; streaming: boolean }) {
  const { color } = useTheme();
	  const trace = useTraceStore((s) => s.byMessage[messageId]);
	  const expanded = useTraceStore((s) => s.expanded[messageId] ?? false);
	  const toggle = useTraceStore((s) => s.toggle);
	  const [detail, setDetail] = useState<TraceNode | null>(null);
	  const nodes = trace ?? [];
	
	  if (nodes.length === 0) return null;
	
	  const thinkingSteps = nodes.filter((n) => n.kind === "thinking").length;
	  const toolCalls = nodes.filter((n) => n.kind === "tool_call").length;
	  const elapsedMs = nodes.reduce((s, n) => s + (n.latencyMs ?? 0), 0);

  return (
    <View style={{ marginTop: space[2], alignSelf: "flex-start", maxWidth: "100%" }}>
      <Pressable
        testID="traceToggle"
        onPress={() => toggle(messageId)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "추론 과정 접기" : "추론 과정 펼치기"}
        style={{
          backgroundColor: color("trace-summary"),
          borderRadius: radius.lg,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
        }}
      >
        <Text style={{ color: color("on-trace-summary"), fontSize: fontSize.caption, fontWeight: "600" }}>
          🧠 {thinkingSteps}단계 · 🛠 {toolCalls}개 툴 · ⏱ {(elapsedMs / 1000).toFixed(1)}초
        </Text>
        {streaming ? (
          <Text style={{ color: color("on-trace-summary"), fontSize: fontSize.caption }}>⟳</Text>
        ) : (
          <Text style={{ color: color("on-trace-summary"), fontSize: fontSize.caption }}>{expanded ? "▲" : "▼"}</Text>
        )}
      </Pressable>

      {expanded ? (
        <View
          style={{
            marginTop: space[2],
            borderLeftWidth: 2,
            borderLeftColor: color("border-strong"),
            paddingLeft: space[3],
            gap: space[2],
          }}
        >
	          {nodes.map((node) => (
            <Pressable
              key={node.seq}
              onPress={() => setDetail(node)}
              accessibilityRole="button"
              accessibilityLabel={`${nodeTitle(node)} 원본 보기`}
              style={{
                backgroundColor: color("surface-elevated"),
                borderRadius: radius.md,
                padding: space[3],
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Text style={{ fontSize: fontSize.body }}>{nodeIcon(node)}</Text>
                <Text style={{ color: color("text-primary"), fontSize: fontSize["body-sm"], fontWeight: "600", flex: 1 }}>
                  {nodeTitle(node)}
                </Text>
                {node.latencyMs ? (
                  <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>
                    {node.latencyMs}ms
                  </Text>
                ) : null}
              </View>
              {node.kind === "thinking" && node.payload.content ? (
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, marginTop: space[1] }} numberOfLines={3}>
                  {String(node.payload.content)}
                </Text>
              ) : null}
              {node.kind === "tool_result" && node.payload.preview ? (
                <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, marginTop: space[1] }} numberOfLines={2}>
                  {String(node.payload.preview)}
                </Text>
              ) : null}
            </Pressable>
          ))}
          {streaming ? (
            <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption }}>응답 생성 중…</Text>
          ) : null}
        </View>
      ) : null}

      <Modal visible={detail !== null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable
          onPress={() => setDetail(null)}
          style={{ flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: color("surface"),
              borderTopLeftRadius: radius["2xl"],
              borderTopRightRadius: radius["2xl"],
              padding: space[5],
              maxHeight: "70%",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space[3] }}>
              <Text style={{ color: color("text-primary"), fontSize: fontSize["title-sm"], fontWeight: "700" }}>
                {detail ? `${nodeIcon(detail)} ${nodeTitle(detail)}` : ""}
              </Text>
              <Pressable onPress={() => setDetail(null)} hitSlop={8} style={{ minHeight: touch.min, justifyContent: "center" }}>
                <Text style={{ color: color("primary"), fontSize: fontSize.body }}>닫기</Text>
              </Pressable>
            </View>
            <ScrollView style={{ backgroundColor: color("surface-elevated"), borderRadius: radius.md, padding: space[3] }}>
              <Text style={{ fontFamily: MONO, fontSize: fontSize.code, color: color("text-primary") }} selectable>
                {detail ? JSON.stringify(maskNode(detail), null, 2) : ""}
              </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
