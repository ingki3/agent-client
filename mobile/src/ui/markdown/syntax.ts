/**
 * Lightweight syntax tokenizer for fenced code blocks (FR-15).
 *
 * 디자인 결정 (TECH §3.3) — react-syntax-highlighter + hljs 풀-스펙은 RN 번들에
 * 100KB+ 추가되고 cold start 에 영향을 준다. MVP 채팅 메시지는 짧은 코드 블록이
 * 대부분이므로 자체 regex-tokenizer 로 js / ts / json / bash / sh 5개를 다룬다.
 * 미지원 언어 (`text` 또는 명시 없음) 는 plain 으로 떨어진다.
 *
 * 토큰 색은 design token 의 의미적 슬롯을 따른다 (호출자가 매핑):
 *   - keyword / control       → primary
 *   - string / template       → success
 *   - number / boolean / null → warning
 *   - comment                 → text-disabled
 *   - identifier / plain      → text-primary
 */

export type SyntaxKind =
  | 'keyword'
  | 'string'
  | 'number'
  | 'boolean'
  | 'comment'
  | 'plain';

export interface SyntaxSegment {
  kind: SyntaxKind;
  text: string;
}

const JS_KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
  'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'let', 'new', 'null', 'of', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'try', 'type', 'typeof', 'undefined', 'var',
  'void', 'while', 'yield', 'as', 'async', 'true', 'false',
]);

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until',
  'case', 'esac', 'in', 'function', 'return', 'exit', 'set', 'export',
  'echo', 'cd', 'ls', 'cat', 'grep', 'find', 'awk', 'sed', 'mkdir', 'rm',
  'cp', 'mv', 'sudo',
]);

const BOOL_NULL = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False']);

interface LangPatterns {
  comment?: RegExp;
  string?: RegExp;
  number?: RegExp;
  ident?: RegExp;
  keywords?: Set<string>;
}

const LANG: Record<string, LangPatterns> = {
  js: {
    comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
    string: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y,
    number: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y,
    ident: /[A-Za-z_$][A-Za-z0-9_$]*/y,
    keywords: JS_KEYWORDS,
  },
  json: {
    string: /"(?:[^"\\\n]|\\.)*"/y,
    number: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y,
    ident: /[A-Za-z_][A-Za-z0-9_]*/y,
    keywords: new Set(['true', 'false', 'null']),
  },
  bash: {
    comment: /#[^\n]*/y,
    string: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y,
    number: /\b\d+\b/y,
    ident: /[A-Za-z_][A-Za-z0-9_-]*/y,
    keywords: BASH_KEYWORDS,
  },
};

LANG.ts = LANG.js!;
LANG.tsx = LANG.js!;
LANG.jsx = LANG.js!;
LANG.javascript = LANG.js!;
LANG.typescript = LANG.js!;
LANG.sh = LANG.bash!;
LANG.shell = LANG.bash!;
LANG.zsh = LANG.bash!;

export function highlight(source: string, lang: string | undefined): SyntaxSegment[] {
  const patterns = lang ? LANG[lang.toLowerCase()] : undefined;
  if (!patterns) {
    return [{ kind: 'plain', text: source }];
  }

  const segments: SyntaxSegment[] = [];
  let buffer = '';
  let i = 0;

  const flushPlain = () => {
    if (buffer) {
      segments.push({ kind: 'plain', text: buffer });
      buffer = '';
    }
  };

  while (i < source.length) {
    if (patterns.comment) {
      patterns.comment.lastIndex = i;
      const m = patterns.comment.exec(source);
      if (m) {
        flushPlain();
        segments.push({ kind: 'comment', text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (patterns.string) {
      patterns.string.lastIndex = i;
      const m = patterns.string.exec(source);
      if (m) {
        flushPlain();
        segments.push({ kind: 'string', text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (patterns.number) {
      patterns.number.lastIndex = i;
      const m = patterns.number.exec(source);
      if (m) {
        flushPlain();
        segments.push({ kind: 'number', text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (patterns.ident) {
      patterns.ident.lastIndex = i;
      const m = patterns.ident.exec(source);
      if (m) {
        const word = m[0];
        if (BOOL_NULL.has(word)) {
          flushPlain();
          segments.push({ kind: 'boolean', text: word });
        } else if (patterns.keywords?.has(word)) {
          flushPlain();
          segments.push({ kind: 'keyword', text: word });
        } else {
          buffer += word;
        }
        i += word.length;
        continue;
      }
    }
    buffer += source[i] ?? '';
    i += 1;
  }
  flushPlain();
  return segments;
}
