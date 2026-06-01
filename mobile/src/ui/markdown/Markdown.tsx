/**
 * GFM markdown renderer (FR-15). Consumes the dependency-free AST from
 * `parseMarkdown` and maps it to RN primitives. Code fences use a monospace box
 * (language label shown; no syntax highlight in the MVP build to avoid a heavy dep —
 * the renderer is AST-based so highlighting can be added behind the same interface).
 *
 * `streaming` enables the safe-incomplete-token policy (no raw `**` / dangling
 * fences shown mid-stream) and renders an unterminated code fence as a loading box.
 */
import { memo, useState, type ReactNode } from "react";
import { View, Text, Linking, Platform, Pressable, ScrollView, type TextStyle } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/design/theme";
import { fontSize, radius, space } from "@/design/tokens";
import { parseMarkdown } from "@/domain/markdown/parse";
import type { Align, Block, Inline } from "@/domain/markdown/types";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type Colors = ReturnType<typeof useTheme>["color"];

function renderInline(nodes: Inline[], color: Colors, baseColor: string, key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    switch (n.type) {
      case "text":
        return (
          <Text key={k} style={{ color: baseColor }}>
            {n.value}
          </Text>
        );
      case "strong":
        return (
          <Text key={k} style={{ fontWeight: "700", color: baseColor }}>
            {renderInline(n.children, color, baseColor, k)}
          </Text>
        );
      case "em":
        return (
          <Text key={k} style={{ fontStyle: "italic", color: baseColor }}>
            {renderInline(n.children, color, baseColor, k)}
          </Text>
        );
      case "del":
        return (
          <Text key={k} style={{ textDecorationLine: "line-through", color: baseColor }}>
            {renderInline(n.children, color, baseColor, k)}
          </Text>
        );
      case "code":
        return (
          <Text
            key={k}
            style={{
              fontFamily: MONO,
              fontSize: fontSize.code,
              color: color("on-trace-summary"),
              backgroundColor: color("trace-summary"),
            }}
          >
            {` ${n.value} `}
          </Text>
        );
      case "link":
        return (
          <Text
            key={k}
            style={{ color: color("primary"), textDecorationLine: "underline" }}
            onPress={() => void Linking.openURL(n.href).catch(() => undefined)}
          >
            {renderInline(n.children, color, color("primary"), k)}
          </Text>
        );
    }
  });
}

function alignStyle(a: Align): TextStyle {
  return { textAlign: a === "center" ? "center" : a === "right" ? "right" : "left" };
}

/** Fenced code block — header bar (language + copy) over a horizontally-scrollable
 *  monospace body, à la Telegram/IDE. Long lines scroll instead of wrapping. */
function CodeBlock({ lang, text, loading }: { lang: string | null; text: string; loading: boolean }) {
  const { color } = useTheme();
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View
      style={{
        marginVertical: space[2],
        borderRadius: radius.md,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: color("border"),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: color("surface-elevated"),
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          borderBottomWidth: 1,
          borderBottomColor: color("border"),
        }}
      >
        <Text style={{ color: color("text-secondary"), fontSize: fontSize.caption, fontFamily: MONO }}>
          {lang ?? "code"}
        </Text>
        {loading ? null : (
          <Pressable onPress={onCopy} hitSlop={8} accessibilityRole="button" accessibilityLabel="코드 복사">
            <Text style={{ color: copied ? color("primary") : color("text-secondary"), fontSize: fontSize.caption, fontWeight: "600" }}>
              {copied ? "복사됨" : "⧉ 복사"}
            </Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: color("surface") }}
        contentContainerStyle={{ padding: space[3] }}
      >
        <Text selectable style={{ fontFamily: MONO, fontSize: fontSize.code, color: color("text-primary"), lineHeight: fontSize.code * 1.5 }}>
          {loading ? "▍" : text}
        </Text>
      </ScrollView>
    </View>
  );
}

function Blocks({ blocks, baseColor }: { blocks: Block[]; baseColor: string }) {
  const { color } = useTheme();
  const lineHeight = fontSize.body * 1.5;

  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "heading": {
            const sizes = [fontSize["title-lg"], fontSize["title-md"], fontSize["body-lg"], fontSize["title-sm"], fontSize.body, fontSize["body-sm"]];
            return (
              <Text
                key={key}
                style={{
                  fontSize: sizes[b.level - 1],
                  fontWeight: "700",
                  color: baseColor,
                  marginTop: i === 0 ? 0 : space[3],
                  marginBottom: space[1],
                }}
              >
                {renderInline(b.inline, color, baseColor, key)}
              </Text>
            );
          }
          case "paragraph":
            return (
              <Text key={key} style={{ fontSize: fontSize.body, lineHeight, color: baseColor, marginVertical: space[1] }}>
                {renderInline(b.inline, color, baseColor, key)}
              </Text>
            );
          case "code":
            return <CodeBlock key={key} lang={b.lang} text={b.text} loading={b.loading} />;
          case "blockquote":
            return (
              <View
                key={key}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: color("border-strong"),
                  paddingLeft: space[3],
                  marginVertical: space[1],
                }}
              >
                <Blocks blocks={b.children} baseColor={color("text-secondary")} />
              </View>
            );
          case "hr":
            return <View key={key} style={{ height: 1, backgroundColor: color("border"), marginVertical: space[3] }} />;
          case "list":
            return (
              <View key={key} style={{ marginVertical: space[1], gap: space[1] }}>
                {b.items.map((item, idx) => (
                  <View key={`${key}-${idx}`} style={{ flexDirection: "row", gap: space[2] }}>
                    <Text style={{ color: baseColor, fontSize: fontSize.body, lineHeight }}>
                      {item.checked !== null ? (item.checked ? "☑" : "☐") : b.ordered ? `${idx + 1}.` : "•"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: baseColor, fontSize: fontSize.body, lineHeight }}>
                        {renderInline(item.inline, color, baseColor, `${key}-${idx}`)}
                      </Text>
                      {item.children.length > 0 ? (
                        <View style={{ paddingLeft: space[3] }}>
                          <Blocks blocks={item.children} baseColor={baseColor} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            );
          case "table":
            return (
              <View
                key={key}
                style={{
                  borderWidth: 1,
                  borderColor: color("border"),
                  borderRadius: radius.md,
                  marginVertical: space[2],
                  overflow: "hidden",
                }}
              >
                <Row cells={b.header} align={b.align} baseColor={baseColor} header />
                {b.rows.map((row, ri) => (
                  <Row key={`${key}-r${ri}`} cells={row} align={b.align} baseColor={baseColor} />
                ))}
              </View>
            );
        }
      })}
    </>
  );
}

function Row({
  cells,
  align,
  baseColor,
  header = false,
}: {
  cells: Inline[][];
  align: Align[];
  baseColor: string;
  header?: boolean;
}) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: header ? color("surface-elevated") : "transparent" }}>
      {cells.map((cell, ci) => (
        <View
          key={ci}
          style={{
            flex: 1,
            padding: space[2],
            borderColor: color("border"),
            borderRightWidth: ci < cells.length - 1 ? 1 : 0,
            borderTopWidth: header ? 0 : 1,
          }}
        >
          <Text
            style={[
              { color: baseColor, fontSize: fontSize["body-sm"], fontWeight: header ? "700" : "400" },
              alignStyle(align[ci] ?? null),
            ]}
          >
            {renderInline(cell, color, baseColor, `cell-${ci}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export const Markdown = memo(function Markdown({
  text,
  baseColor,
  streaming = false,
}: {
  text: string;
  baseColor: string;
  streaming?: boolean;
}) {
  const blocks = parseMarkdown(text, streaming);
  return <Blocks blocks={blocks} baseColor={baseColor} />;
});
