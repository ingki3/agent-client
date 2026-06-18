/**
 * Markdown — GFM full-spec renderer for chat bubbles (FR-15, TECH §3.3).
 *
 * Pipeline (no HTML at any step):
 *   text → parser.ts (marked lexer) → BlockNode tree → React Native View / Text
 *
 * Memoization:
 *   - Component is memo() — re-renders only when text or layout-affecting props change.
 *   - Internal parse result is cached by exact text identity in a small LRU. Chat
 *     bubbles re-render frequently as scroll changes; cache hit = no marked work.
 *
 * Sandboxing:
 *   - HTML tokens are dropped in parser.ts. Links go through onLinkPress (default:
 *     expo-linking openURL). Image rendering uses expo-image with cache=memory-disk.
 */
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { memo, useMemo, useCallback, type ReactNode } from 'react';
import { Linking as RNLinking, StyleSheet, Text, View } from 'react-native';

import { parseMarkdown, type BlockNode, type InlineNode, type ListItem } from './parser';
import { highlight, type SyntaxKind } from './syntax';
import { useTheme } from '../theme/ThemeProvider';
import { fontFamily, fontSize, radius, space } from '../theme/tokens';

const HEADING_SIZE: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: fontSize['title-xl'],
  2: fontSize['title-lg'],
  3: fontSize['title-md'],
  4: fontSize['title-sm'],
  5: fontSize['body-lg'],
  6: fontSize.body,
};

/** Author of the message — bubble owner. Drives text-color inheritance. */
export type MarkdownContext = 'user' | 'agent' | 'system';

export interface MarkdownProps {
  text: string;
  context?: MarkdownContext;
  /** Override link tap (default: openURL via expo-linking). */
  onLinkPress?: (href: string) => void;
  /** Forced max width for embedded images (defaults to 240). */
  imageMaxWidth?: number;
}

const parseCache = new Map<string, ReturnType<typeof parseMarkdown>>();
const PARSE_CACHE_MAX = 128;

function getParsed(text: string) {
  const cached = parseCache.get(text);
  if (cached) return cached;
  const parsed = parseMarkdown(text);
  if (parseCache.size >= PARSE_CACHE_MAX) {
    // FIFO eviction — `Map` preserves insertion order.
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(text, parsed);
  return parsed;
}

export const Markdown = memo(function Markdown({
  text,
  context = 'agent',
  onLinkPress,
  imageMaxWidth = 240,
}: MarkdownProps) {
  const theme = useTheme();
  const baseColor = theme.color(
    context === 'user' ? 'on-user-bubble' : 'on-agent-bubble',
  );
  const secondaryColor = theme.color('text-secondary');
  const codeBg = theme.color(context === 'user' ? 'surface-overlay' : 'surface-elevated');
  const codeFg = theme.color('text-primary');
  const borderColor = theme.color('border');
  const linkColor = theme.color(context === 'user' ? 'on-user-bubble' : 'primary');
  const blockquoteBar = theme.color('border-strong');

  const syntaxColor: Record<SyntaxKind, string> = {
    keyword: theme.color('primary'),
    string: theme.color('success'),
    number: theme.color('warning'),
    boolean: theme.color('warning'),
    comment: theme.color('text-disabled'),
    plain: codeFg,
  };

  const parsed = useMemo(() => getParsed(text), [text]);

  const handleLink = useCallback(
    (href: string) => {
      if (onLinkPress) onLinkPress(href);
      else void RNLinking.openURL(href).catch(() => Linking.openURL(href));
    },
    [onLinkPress],
  );

  return (
    <View style={styles.root}>
      {parsed.blocks.map((block, i) => (
        <BlockRenderer
          key={i}
          node={block}
          baseColor={baseColor}
          secondaryColor={secondaryColor}
          codeBg={codeBg}
          codeFg={codeFg}
          linkColor={linkColor}
          borderColor={borderColor}
          blockquoteBar={blockquoteBar}
          syntaxColor={syntaxColor}
          onLinkPress={handleLink}
          imageMaxWidth={imageMaxWidth}
        />
      ))}
    </View>
  );
});

interface RenderContext {
  baseColor: string;
  secondaryColor: string;
  codeBg: string;
  codeFg: string;
  linkColor: string;
  borderColor: string;
  blockquoteBar: string;
  syntaxColor: Record<SyntaxKind, string>;
  onLinkPress: (href: string) => void;
  imageMaxWidth: number;
}

interface BlockRendererProps extends RenderContext {
  node: BlockNode;
}

function BlockRenderer(props: BlockRendererProps): ReactNode {
  const { node, baseColor } = props;

  switch (node.type) {
    case 'heading':
      return (
        <Text
          style={{
            color: baseColor,
            fontSize: HEADING_SIZE[node.depth],
            fontFamily: fontFamily.display,
            fontWeight: node.depth <= 3 ? '700' : '600',
            marginTop: node.depth <= 2 ? space[3] : space[2],
            marginBottom: space[1],
          }}
        >
          {renderInline(node.children, props)}
        </Text>
      );
    case 'paragraph':
      return (
        <Text
          style={{
            color: baseColor,
            fontSize: fontSize.body,
            fontFamily: fontFamily.sans,
            lineHeight: fontSize.body * 1.4,
            marginVertical: space[1],
          }}
        >
          {renderInline(node.children, props)}
        </Text>
      );
    case 'hr':
      return (
        <View
          style={{
            height: 1,
            backgroundColor: props.borderColor,
            marginVertical: space[3],
          }}
        />
      );
    case 'blockquote':
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: props.blockquoteBar,
            paddingLeft: space[3],
            marginVertical: space[2],
            opacity: 0.9,
          }}
        >
          {node.children.map((child, i) => (
            <BlockRenderer key={i} {...props} node={child} />
          ))}
        </View>
      );
    case 'code':
      return <CodeBlock node={node} ctx={props} />;
    case 'list':
      return <ListBlock node={node} ctx={props} />;
    case 'table':
      return <TableBlock node={node} ctx={props} />;
  }
}

function ListBlock({
  node,
  ctx,
}: {
  node: Extract<BlockNode, { type: 'list' }>;
  ctx: RenderContext;
}): ReactNode {
  return (
    <View style={{ marginVertical: space[1] }}>
      {node.items.map((item, i) => (
        <ListItemRow
          key={i}
          item={item}
          index={i}
          ordered={node.ordered}
          start={node.start}
          ctx={ctx}
        />
      ))}
    </View>
  );
}

function ListItemRow({
  item,
  index,
  ordered,
  start,
  ctx,
}: {
  item: ListItem;
  index: number;
  ordered: boolean;
  start: number | null;
  ctx: RenderContext;
}): ReactNode {
  const marker = ordered ? `${(start ?? 1) + index}.` : '•';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginVertical: 2 }}>
      {item.task ? (
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: ctx.borderColor,
            backgroundColor: item.checked ? ctx.linkColor : 'transparent',
            marginRight: space[2],
            marginTop: 3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.checked ? (
            <Text
              style={{
                color: ctx.baseColor === ctx.linkColor ? ctx.codeBg : '#FFFFFF',
                fontSize: 12,
                fontWeight: '900',
                lineHeight: 14,
              }}
            >
              ✓
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          style={{
            width: 18,
            color: ctx.secondaryColor,
            fontSize: fontSize.body,
            marginRight: space[1],
          }}
        >
          {marker}
        </Text>
      )}
      <View style={{ flex: 1 }}>
        {item.inline.length > 0 ? (
          <Text
            style={{
              color: ctx.baseColor,
              fontSize: fontSize.body,
              lineHeight: fontSize.body * 1.4,
              textDecorationLine: item.task && item.checked ? 'line-through' : 'none',
            }}
          >
            {renderInline(item.inline, ctx)}
          </Text>
        ) : null}
        {item.blocks.map((block, i) => (
          <BlockRenderer key={i} {...ctx} node={block} />
        ))}
      </View>
    </View>
  );
}

function CodeBlock({
  node,
  ctx,
}: {
  node: Extract<BlockNode, { type: 'code' }>;
  ctx: RenderContext;
}): ReactNode {
  const segs = highlight(node.value, node.lang ?? undefined);
  return (
    <View
      style={{
        backgroundColor: ctx.codeBg,
        borderRadius: radius.md,
        padding: space[3],
        marginVertical: space[2],
        borderWidth: 1,
        borderColor: ctx.borderColor,
      }}
    >
      {node.lang ? (
        <Text
          style={{
            color: ctx.secondaryColor,
            fontSize: fontSize.caption,
            fontFamily: fontFamily.mono,
            marginBottom: space[1],
          }}
        >
          {node.lang}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: fontFamily.mono,
          fontSize: fontSize.code,
          lineHeight: fontSize.code * 1.45,
          color: ctx.syntaxColor.plain,
        }}
      >
        {segs.map((seg, i) => (
          <Text key={i} style={{ color: ctx.syntaxColor[seg.kind] }}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function TableBlock({
  node,
  ctx,
}: {
  node: Extract<BlockNode, { type: 'table' }>;
  ctx: RenderContext;
}): ReactNode {
  const alignStyle = (i: number): 'left' | 'right' | 'center' =>
    node.align[i] ?? 'left';
  return (
    <View
      style={{
        marginVertical: space[2],
        borderWidth: 1,
        borderColor: ctx.borderColor,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: ctx.codeBg,
          borderBottomWidth: 1,
          borderBottomColor: ctx.borderColor,
        }}
      >
        {node.header.map((cell, i) => (
          <Text
            key={i}
            style={{
              flex: 1,
              padding: space[2],
              fontWeight: '700',
              fontSize: fontSize['body-sm'],
              color: ctx.baseColor,
              textAlign: alignStyle(i),
            }}
          >
            {renderInline(cell.children, ctx)}
          </Text>
        ))}
      </View>
      {node.rows.map((row, ri) => (
        <View
          key={ri}
          style={{
            flexDirection: 'row',
            borderBottomWidth: ri === node.rows.length - 1 ? 0 : 1,
            borderBottomColor: ctx.borderColor,
          }}
        >
          {row.map((cell, ci) => (
            <Text
              key={ci}
              style={{
                flex: 1,
                padding: space[2],
                fontSize: fontSize['body-sm'],
                color: ctx.baseColor,
                textAlign: alignStyle(ci),
              }}
            >
              {renderInline(cell.children, ctx)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderInline(nodes: InlineNode[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, i) => renderInlineNode(node, i, ctx));
}

function renderInlineNode(node: InlineNode, key: number, ctx: RenderContext): ReactNode {
  switch (node.type) {
    case 'text':
      return <Text key={key}>{node.value}</Text>;
    case 'break':
      return <Text key={key}>{'\n'}</Text>;
    case 'bold':
      return (
        <Text key={key} style={{ fontWeight: '700' }}>
          {renderInline(node.children, ctx)}
        </Text>
      );
    case 'italic':
      return (
        <Text key={key} style={{ fontStyle: 'italic' }}>
          {renderInline(node.children, ctx)}
        </Text>
      );
    case 'strike':
      return (
        <Text key={key} style={{ textDecorationLine: 'line-through' }}>
          {renderInline(node.children, ctx)}
        </Text>
      );
    case 'codespan':
      return (
        <Text
          key={key}
          style={{
            fontFamily: fontFamily.mono,
            fontSize: fontSize.code,
            backgroundColor: ctx.codeBg,
            color: ctx.codeFg,
            paddingHorizontal: 4,
            borderRadius: radius.sm,
          }}
        >
          {node.value}
        </Text>
      );
    case 'link':
      return (
        <Text
          key={key}
          style={{ color: ctx.linkColor, textDecorationLine: 'underline' }}
          onPress={() => ctx.onLinkPress(node.href)}
        >
          {renderInline(node.children, ctx)}
        </Text>
      );
    case 'image':
      return (
        <Image
          key={key}
          source={{ uri: node.src }}
          accessibilityLabel={node.alt}
          contentFit="contain"
          cachePolicy="memory-disk"
          style={{
            width: ctx.imageMaxWidth,
            height: ctx.imageMaxWidth * 0.6,
            borderRadius: radius.md,
            marginVertical: space[1],
          }}
        />
      );
  }
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'column',
  },
});

/** Test/perf helper — drop the in-process parse cache. */
export function _resetMarkdownCache() {
  parseCache.clear();
}
