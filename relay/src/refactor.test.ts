import { helperSubmitText } from "./helper/submitFormatter.js";
import { extractJsonText } from "./llm.js";
import { extractInlineKeyboard } from "./telegram/inlineKeyboard.js";
import { normalizeMediaKind, telegramDocumentAttributes, telegramSafeFileName } from "./telegram/mediaPayload.js";
import { updateFromTelegramMessage } from "./telegram/messageNormalizer.js";
import { buildTtsScriptPrompt } from "./tts.js";

let ok = 0;
let bad = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
  cond ? ok++ : bad++;
}

console.log("\n== Relay refactor unit ==\n");

{
  check("llm json extractor strips thinking and fences", extractJsonText("<think>hmm</think>\n```json\n{\"ok\":true}\n```") === "{\"ok\":true}");
}

{
  const text = helperSubmitText({
    deviceId: "dev",
    peerId: 1,
    helperItemId: "h1",
    helperType: "quick_replies",
    action: "quick_reply",
    value: "자세히 설명해줘",
    source: {
      messageId: 42,
      text: "x".repeat(5000),
      recentMessages: Array.from({ length: 8 }, (_, i) => ({ messageId: i, role: "agent", text: "recent ".repeat(80) })),
    },
  });
  check("helper submit keeps agent_helper_response block", text.includes("```agent_helper_response"));
  check("helper submit stays within Telegram-safe limit", text.length <= 3800);
  check("helper submit includes selected value", text.includes("자세히 설명해줘"));
}

{
  const keyboard = extractInlineKeyboard({
    className: "ReplyInlineMarkup",
    rows: [
      { buttons: [{ className: "KeyboardButtonCallback", text: "확인" }, { className: "KeyboardButtonUrl", text: "열기", url: "https://example.com" }] },
      { buttons: [{ className: "KeyboardButtonCopy", text: "복사", copyText: "copy-me" }] },
    ],
  });
  check("inline keyboard extracts rows", keyboard?.rows.length === 2);
  check("inline keyboard preserves callback type", keyboard?.rows[0]?.[0]?.type === "callback");
  check("inline keyboard preserves url", keyboard?.rows[0]?.[1]?.url === "https://example.com");
  check("inline keyboard preserves copy text", keyboard?.rows[1]?.[0]?.copyText === "copy-me");
}

{
  check("media kind falls back from mime", normalizeMediaKind("document", "image/png") === "image");
  check("telegram file name gets extension from mime", telegramSafeFileName("picked-file", "application/pdf") === "picked-file.pdf");
  check("telegram file name strips unsafe separators", telegramSafeFileName("a/b:c", "text/plain") === "a_b_c.txt");
  check("document upload keeps filename attribute", telegramDocumentAttributes({ kind: "document", fileName: "a.txt" })?.[0]?.className === "DocumentAttributeFilename");
}

{
  const update = updateFromTelegramMessage({
    deviceId: "dev",
    peer: { peer_id: 1001, title: "Agent" },
    msg: {
      id: 7,
      date: 123,
      out: false,
      message: "진행 상황 summarize 시작 – {}\nTranscript: 최종 답변입니다.",
      replyMarkup: {
        className: "ReplyInlineMarkup",
        rows: [{ buttons: [{ className: "KeyboardButtonCallback", text: "더 보기" }] }],
      },
    },
  });
  check("message normalizer produces update", !!update?.message);
  check("message normalizer removes operational transcript prefix", update?.message?.text === "최종 답변입니다.");
  check("message normalizer preserves inline keyboard", update?.message?.inline_keyboard?.rows[0]?.[0]?.label === "더 보기");
}

{
  const briefPrompt = buildTtsScriptPrompt("긴 문서 본문", "brief");
  const explainPrompt = buildTtsScriptPrompt("긴 문서 본문", "explain");
  const actionPrompt = buildTtsScriptPrompt("긴 문서 본문", "action_items");
  check("tts prompt asks to rewrite for human narration by default", briefPrompt.includes("새로 작성") && briefPrompt.includes("사람이 읽어주는"));
  check("tts brief prompt keeps only short key points", briefPrompt.includes("핵심 내용만") && briefPrompt.includes("짧게"));
  check("tts explain prompt asks detailed conversational explanation", explainPrompt.includes("대화형") && explainPrompt.includes("상세히 설명"));
  check("tts action prompt focuses on user decisions and actions", actionPrompt.includes("판단") && actionPrompt.includes("해야 할 액션"));
  check("tts prompt does not ask to simply read document", !briefPrompt.includes("read the document verbatim"));
}

console.log(`\n== ${ok} passed, ${bad} failed ==\n`);
if (bad) process.exit(1);
