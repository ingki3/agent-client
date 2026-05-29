/**
 * Live smoke test for the Telegram-compatible Bot API path. Mirrors the exact request
 * shape of src/infrastructure/api/telegramBotApi.ts (`POST {gateway}/bot{token}/{method}`
 * with a JSON body, parsing the `{ok,result}|{ok:false,error_code,description}` envelope)
 * and runs it against the real api.telegram.org. Node 18+ (global fetch).
 *
 * Usage: node scripts/smoke-telegram.mjs <token> <chatId>
 */
const GATEWAY = "https://api.telegram.org";
const [, , TOKEN, CHAT_ID] = process.argv;

if (!TOKEN || !CHAT_ID) {
  console.error("usage: node scripts/smoke-telegram.mjs <token> <chatId>");
  process.exit(1);
}

class BotApiError extends Error {
  constructor(code, description) {
    super(`Bot API ${code}: ${description}`);
    this.code = code;
    this.description = description;
  }
}

async function call(method, params) {
  const url = `${GATEWAY}/bot${TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const body = await res.json();
  if (!body.ok) throw new BotApiError(body.error_code, body.description);
  return body.result;
}

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

let ok = 0;
let bad = 0;

async function step(name, fn) {
  try {
    const r = await fn();
    pass(name);
    ok++;
    return r;
  } catch (e) {
    fail(`${name} — ${e instanceof BotApiError ? e.message : String(e)}`);
    bad++;
    return null;
  }
}

console.log("\n== Telegram Bot API smoke (live) ==\n");

// FR-05 / S-12-13: getMe (token validation + preview metadata)
const me = await step("getMe → token valid, returns bot meta", async () => {
  const m = await call("getMe");
  if (!m.is_bot) throw new Error("not a bot");
  console.log(`      bot: ${m.first_name} (@${m.username}) id=${m.id}`);
  return m;
});

// UC-04: typing indicator before send
await step("sendChatAction(typing)", () => call("sendChatAction", { chat_id: CHAT_ID, action: "typing" }));

// FR-11/16: sendMessage (the chat send path)
const sent = await step("sendMessage → delivers to chat", async () => {
  const msg = await call("sendMessage", {
    chat_id: CHAT_ID,
    text: "✅ Agent Client 연동 테스트입니다.\n*Telegram 호환 Bot API* 로 전송되었어요.",
  });
  console.log(`      message_id=${msg.message_id} chat=${msg.chat.id} (${msg.chat.type})`);
  return msg;
});

// FR-16: editMessageText (status/streaming finalize path uses this for live gateways)
if (sent) {
  await step("editMessageText → edits the sent message", () =>
    call("editMessageText", {
      chat_id: CHAT_ID,
      message_id: sent.message_id,
      text: "✏️ (편집됨) Agent Client editMessageText 테스트 완료.",
    }),
  );
}

// FR-14/20 + chat store poller: getUpdates long-poll (timeout short for the test)
await step("getUpdates → returns update array", async () => {
  const updates = await call("getUpdates", { offset: 0, timeout: 1, allowed_updates: ["message", "edited_message"] });
  console.log(`      ${updates.length} pending update(s)`);
  for (const u of updates.slice(-3)) {
    const m = u.message ?? u.edited_message;
    if (m?.text) console.log(`      ↳ from chat ${m.chat.id}: ${JSON.stringify(m.text).slice(0, 60)}`);
  }
  return updates;
});

// Negative: invalid token must surface a 401 (S-12 inline error path)
await step("getMe(bad token) → 401 BotApiError (negative)", async () => {
  const url = `${GATEWAY}/bot000:invalid/getMe`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.json();
  if (body.ok) throw new Error("expected failure");
  if (body.error_code !== 401) throw new Error(`expected 401, got ${body.error_code}`);
  console.log(`      rejected: ${body.error_code} ${body.description}`);
});

console.log(`\n== ${ok} passed, ${bad} failed ==\n`);
process.exit(bad > 0 ? 1 : 0);
