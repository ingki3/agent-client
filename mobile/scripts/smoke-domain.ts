/**
 * Runs the real domain modules (no RN imports) to verify behavior.
 * Run: node --experimental-strip-types scripts/smoke-domain.ts
 */
import { parseMarkdown } from "../src/domain/markdown/parse";
import { maskArgs, canTransition } from "../src/domain/entities";

let ok = 0;
let bad = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    ok++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    bad++;
  }
}

console.log("\n== Domain smoke ==\n");

// GFM full-spec parse (FR-15)
const md = `# 제목
일반 **굵게** 와 *기울임* 과 ~~취소선~~ 과 \`code\`.

- [x] 완료
- [ ] 미완료

| A | B |
|---|:--:|
| 1 | 2 |

\`\`\`ts
const x = 1;
\`\`\`

> 인용문
`;
const blocks = parseMarkdown(md);
const types = blocks.map((b) => b.type);
check("heading parsed", types.includes("heading"));
check("task list parsed", blocks.some((b) => b.type === "list" && b.items.some((i) => i.checked === true)));
check("table parsed with center align", blocks.some((b) => b.type === "table" && b.align[1] === "center"));
check("fenced code parsed with lang", blocks.some((b) => b.type === "code" && b.lang === "ts"));
check("blockquote parsed", types.includes("blockquote"));

// Safe-incremental streaming (FR-15 / TECH_SPEC §3.3): dangling ** must not leak raw
const streamed = parseMarkdown("진행 중 **굵게가 아직", true);
const flat = JSON.stringify(streamed);
check("streaming suppresses dangling ** marker", !flat.includes("**") && flat.includes("굵게가 아직"));

// Unterminated code fence → loading box while streaming
const openFence = parseMarkdown("```js\nconst a =", true);
check("unterminated fence marked loading", openFence.some((b) => b.type === "code" && b.loading === true));

// Sensitive arg masking (FR-19, Q7)
const masked = maskArgs({ query: "hi", api_key: "sk-secret", nested: { token: "abc", keep: 1 } });
check("api_key masked", masked.api_key === "••••••••");
check("nested token masked", (masked.nested as Record<string, unknown>).token === "••••••••");
check("non-sensitive kept", masked.query === "hi");

// Status transitions (domain rules)
check("sending → sent allowed", canTransition("sending", "sent"));
check("done → sending blocked", !canTransition("done", "sending"));
check("failed → sending allowed (retry)", canTransition("failed", "sending"));

console.log(`\n== ${ok} passed, ${bad} failed ==\n`);
process.exit(bad > 0 ? 1 : 0);
