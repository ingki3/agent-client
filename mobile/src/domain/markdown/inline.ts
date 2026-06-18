/**
 * Inline tokenizer: code, strong, em, strikethrough, links.
 *
 * Safe-incremental policy (FR-15, TECH_SPEC §3.3): when `streaming` is true, a
 * dangling opener with no matching closer (`**`, `` ` ``, `[`) is NOT rendered as a
 * raw marker — the marker characters are dropped and the inner text shown plain, so
 * the user never sees half-formed syntax mid-stream.
 */
import type { Inline } from "./types";

const EMPH = ["***", "**", "__", "*", "_"] as const;

export function parseInline(src: string, streaming = false): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);

    // Inline code: `...`
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end === -1) {
        if (streaming) {
          i += 1; // drop dangling backtick
          continue;
        }
        buf += ch;
        i += 1;
        continue;
      }
      flush();
      out.push({ type: "code", value: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Link: [text](href)
    if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close !== -1 && src[close + 1] === "(") {
        const paren = src.indexOf(")", close + 2);
        if (paren !== -1) {
          flush();
          out.push({
            type: "link",
            href: src.slice(close + 2, paren),
            children: parseInline(src.slice(i + 1, close), streaming),
          });
          i = paren + 1;
          continue;
        }
      }
      if (streaming && close === -1) {
        i += 1; // drop dangling '['
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // Strikethrough: ~~...~~
    if (rest.startsWith("~~")) {
      const end = src.indexOf("~~", i + 2);
      if (end !== -1) {
        flush();
        out.push({ type: "del", children: parseInline(src.slice(i + 2, end), streaming) });
        i = end + 2;
        continue;
      }
      if (streaming) {
        i += 2;
        continue;
      }
      buf += "~~";
      i += 2;
      continue;
    }

    // Emphasis (strong / em), longest marker first
    const marker = EMPH.find((m) => rest.startsWith(m));
    if (marker) {
      const end = src.indexOf(marker, i + marker.length);
      if (end !== -1 && end > i + marker.length) {
        flush();
        const inner = parseInline(src.slice(i + marker.length, end), streaming);
        if (marker === "***") {
          out.push({ type: "strong", children: [{ type: "em", children: inner }] });
        } else if (marker === "**" || marker === "__") {
          out.push({ type: "strong", children: inner });
        } else {
          out.push({ type: "em", children: inner });
        }
        i = end + marker.length;
        continue;
      }
      if (streaming) {
        i += marker.length; // drop dangling emphasis opener
        continue;
      }
      buf += marker;
      i += marker.length;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}
