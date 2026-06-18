/**
 * Markdown parser — `marked` v15 lexer 만 사용해서 normalized AST 로 변환한다 (FR-15).
 *
 * `marked.parse()` 의 HTML 생성기는 사용하지 않는다. RN 트리는 ui/markdown/Markdown.tsx
 * 가 직접 build (expo-image, View, Text). 따라서 호출은 항상 `lexer(text)` 뿐이며,
 * 결과는 우리 코드가 안전하게 walk 하기 위한 discriminated union 으로 좁힌다.
 */
import { lexer } from 'marked';

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'codespan'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export type BlockNode =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'list'; ordered: boolean; start: number | null; items: ListItem[] }
  | { type: 'table'; header: TableCell[]; rows: TableCell[][]; align: Array<'left' | 'right' | 'center' | null> }
  | { type: 'hr' };

export interface ListItem {
  task: boolean;
  checked: boolean;
  /** Block-level content of the list item (text + nested lists). */
  blocks: BlockNode[];
  /** Inline-only fast path: if blocks is empty, fall back to inline children. */
  inline: InlineNode[];
}

export interface TableCell {
  children: InlineNode[];
}

export interface MarkdownDocument {
  blocks: BlockNode[];
}

export function parseMarkdown(source: string): MarkdownDocument {
  const tokens = lexer(source, { gfm: true, breaks: false }) as unknown as AnyToken[];
  return { blocks: convertBlocks(tokens) };
}

type AnyToken = Record<string, unknown> & { type: string };

function convertBlocks(tokens: ReadonlyArray<AnyToken>): BlockNode[] {
  const out: BlockNode[] = [];
  for (const raw of tokens) {
    const tok = raw as AnyToken;
    switch (tok.type) {
      case 'heading': {
        const depth = clampDepth(tok.depth as number);
        out.push({
          type: 'heading',
          depth,
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      }
      case 'paragraph': {
        out.push({
          type: 'paragraph',
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      }
      case 'blockquote': {
        out.push({
          type: 'blockquote',
          children: convertBlocks((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      }
      case 'code': {
        out.push({
          type: 'code',
          lang: (tok.lang as string | undefined)?.trim() || null,
          value: (tok.text as string) ?? '',
        });
        break;
      }
      case 'hr': {
        out.push({ type: 'hr' });
        break;
      }
      case 'list': {
        const items = ((tok.items as AnyToken[] | undefined) ?? []).map((item) =>
          convertListItem(item),
        );
        const ordered = Boolean(tok.ordered);
        const startRaw = tok.start as number | string | undefined;
        const start =
          ordered && typeof startRaw === 'number' && startRaw !== 1 ? startRaw : null;
        out.push({ type: 'list', ordered, start, items });
        break;
      }
      case 'table': {
        const header = ((tok.header as AnyToken[] | undefined) ?? []).map(
          (cell) => ({ children: convertInlines((cell.tokens ?? []) as AnyToken[]) }),
        );
        const rows = ((tok.rows as AnyToken[][] | undefined) ?? []).map((row) =>
          row.map((cell) => ({ children: convertInlines((cell.tokens ?? []) as AnyToken[]) })),
        );
        const align = ((tok.align as Array<'left' | 'right' | 'center' | null> | undefined) ?? []);
        out.push({ type: 'table', header, rows, align });
        break;
      }
      case 'space':
      case 'html':
        // Skip — HTML is not supported in our renderer (security + RN safety).
        break;
      default: {
        // Treat anything we don't model as a paragraph with the raw text.
        const text = (tok.text as string | undefined) ?? (tok.raw as string | undefined) ?? '';
        if (text.trim()) {
          out.push({
            type: 'paragraph',
            children: [{ type: 'text', value: text }],
          });
        }
        break;
      }
    }
  }
  return out;
}

function convertListItem(item: AnyToken): ListItem {
  const subTokens = (item.tokens as AnyToken[] | undefined) ?? [];
  const blocks: BlockNode[] = [];
  const inline: InlineNode[] = [];

  for (const sub of subTokens) {
    if (sub.type === 'text') {
      // marked emits list_item children as `text` with their own `.tokens`. Treat
      // the inline-only fast path so simple bullets render without a paragraph wrap.
      const childTokens = (sub.tokens as AnyToken[] | undefined) ?? [];
      if (childTokens.length > 0) {
        inline.push(...convertInlines(childTokens));
      } else {
        inline.push({ type: 'text', value: (sub.text as string) ?? '' });
      }
    } else if (sub.type === 'list' || sub.type === 'code' || sub.type === 'blockquote' ||
               sub.type === 'paragraph' || sub.type === 'heading' ||
               sub.type === 'hr' || sub.type === 'table') {
      blocks.push(...convertBlocks([sub]));
    }
  }

  return {
    task: Boolean(item.task),
    checked: Boolean(item.checked),
    blocks,
    inline,
  };
}

function convertInlines(tokens: ReadonlyArray<AnyToken>): InlineNode[] {
  const out: InlineNode[] = [];
  for (const raw of tokens) {
    const tok = raw as AnyToken;
    switch (tok.type) {
      case 'text': {
        // text token can itself have inline children (e.g. inside list items).
        const childTokens = (tok.tokens as AnyToken[] | undefined) ?? [];
        if (childTokens.length > 0) {
          out.push(...convertInlines(childTokens));
        } else {
          out.push({ type: 'text', value: (tok.text as string) ?? '' });
        }
        break;
      }
      case 'strong':
        out.push({
          type: 'bold',
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      case 'em':
        out.push({
          type: 'italic',
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      case 'del':
        out.push({
          type: 'strike',
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      case 'codespan':
        out.push({ type: 'codespan', value: (tok.text as string) ?? '' });
        break;
      case 'link':
        out.push({
          type: 'link',
          href: (tok.href as string) ?? '',
          children: convertInlines((tok.tokens ?? []) as AnyToken[]),
        });
        break;
      case 'image':
        out.push({
          type: 'image',
          src: (tok.href as string) ?? '',
          alt: (tok.text as string) ?? '',
        });
        break;
      case 'br':
        out.push({ type: 'break' });
        break;
      case 'escape':
        out.push({ type: 'text', value: (tok.text as string) ?? '' });
        break;
      default: {
        const text = (tok.text as string | undefined) ?? '';
        if (text) out.push({ type: 'text', value: text });
        break;
      }
    }
  }
  return out;
}

function clampDepth(d: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (d <= 1) return 1;
  if (d >= 6) return 6;
  return d as 2 | 3 | 4 | 5;
}
