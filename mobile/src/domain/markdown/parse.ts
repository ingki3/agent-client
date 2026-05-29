/**
 * Block-level GFM parser → AST (FR-15). Dependency-free.
 *
 * Supports: ATX headings, fenced code (incl. unterminated → loading box during
 * stream), blockquotes, ordered/unordered lists with nesting + task checkboxes,
 * GFM pipe tables, thematic breaks, and paragraphs. Inline spans are delegated to
 * `parseInline`. When `streaming` is true, dangling inline markers are suppressed.
 */
import type { Align, Block, ListItem } from "./types";
import { parseInline } from "./inline";

const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const ATX = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/;
const UL = /^(\s*)([-*+])\s+(.*)$/;
const OL = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const BLOCKQUOTE = /^ {0,3}>\s?(.*)$/;

function indentLevel(ws: string): number {
  return Math.floor(ws.replace(/\t/g, "  ").length / 2);
}

export function parseMarkdown(src: string, streaming = false): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1]!;
      const lang = (fence[2] ?? "").trim() || null;
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i]!.trimStart().startsWith(marker)) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: "code", lang, text: body.join("\n"), loading: !closed && streaming });
      continue;
    }

    // Thematic break
    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // ATX heading
    const atx = line.match(ATX);
    if (atx) {
      const level = atx[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, inline: parseInline(atx[2] ?? "", streaming) });
      i += 1;
      continue;
    }

    // Blockquote (consume consecutive '>' lines, recurse)
    if (BLOCKQUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && BLOCKQUOTE.test(lines[i]!)) {
        inner.push(lines[i]!.match(BLOCKQUOTE)![1] ?? "");
        i += 1;
      }
      blocks.push({ type: "blockquote", children: parseMarkdown(inner.join("\n"), streaming) });
      continue;
    }

    // GFM table: header row + separator row of ---|:--:
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const header = splitRow(lines[i]!);
      const align = parseAlign(lines[i + 1]!);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      blocks.push({
        type: "table",
        header: header.map((c) => parseInline(c, streaming)),
        align,
        rows: rows.map((r) => r.map((c) => parseInline(c, streaming))),
      });
      continue;
    }

    // Lists
    if (UL.test(line) || OL.test(line)) {
      const { list, next } = parseList(lines, i, streaming);
      blocks.push(list);
      i = next;
      continue;
    }

    // Paragraph: gather until blank / block starter
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !isBlockStart(lines[i]!)) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", inline: parseInline(para.join(" "), streaming) });
  }

  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) ||
    HR.test(line) ||
    ATX.test(line) ||
    BLOCKQUOTE.test(line) ||
    UL.test(line) ||
    OL.test(line)
  );
}

function parseList(
  lines: string[],
  start: number,
  streaming: boolean,
): { list: Extract<Block, { type: "list" }>; next: number } {
  const firstMatch = lines[start]!.match(UL) ?? lines[start]!.match(OL)!;
  const baseIndent = indentLevel(firstMatch[1] ?? "");
  const ordered = OL.test(lines[start]!);
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const m = ordered ? line.match(OL) : line.match(UL);
    if (!m) break;
    const indent = indentLevel(m[1] ?? "");
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      // Nested list belongs to the previous item.
      const nested = parseList(lines, i, streaming);
      if (items.length > 0) items[items.length - 1]!.children.push(nested.list);
      i = nested.next;
      continue;
    }

    let content = m[3] ?? "";
    let checked: boolean | null = null;
    const task = content.match(TASK);
    if (task) {
      checked = task[1]!.toLowerCase() === "x";
      content = task[2] ?? "";
    }
    items.push({ inline: parseInline(content, streaming), checked, children: [] });
    i += 1;
  }

  return { list: { type: "list", ordered, items }, next: i };
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("-")) return false;
  return splitRow(line).every((c) => /^:?-+:?$/.test(c.trim()));
}

function parseAlign(line: string): Align[] {
  return splitRow(line).map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}
