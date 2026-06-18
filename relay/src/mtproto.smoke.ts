/**
 * Live smoke for the MTProto (user-account) path. Boots an in-process relay, logs in as
 * YOUR Telegram account (phone → code → optional 2FA, entered on stdin), resolves a target
 * bot by @username, sends it a message AS YOU, then verifies the bot's reply is buffered
 * and returned by /pull — i.e. auth + send + receive end-to-end, no mobile device needed.
 *
 * Requires app credentials from my.telegram.org:
 *   TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=abc... \
 *   node --import tsx src/mtproto.smoke.ts <+phone> <botUsername>
 *
 * NOTE: this signs into a real account from this machine. Use your own account; honor any
 * FLOOD_WAIT the script reports.
 */
import { createInterface } from "node:readline/promises";

const [, , PHONE, BOT_USERNAME] = process.argv;
if (!PHONE || !BOT_USERNAME) {
  console.error("usage: TELEGRAM_API_ID=… TELEGRAM_API_HASH=… node --import tsx src/mtproto.smoke.ts <+phone> <botUsername>");
  process.exit(1);
}
if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
  console.error("set TELEGRAM_API_ID and TELEGRAM_API_HASH (my.telegram.org)");
  process.exit(1);
}

process.env.RELAY_DB = process.env.RELAY_DB ?? "/tmp/relay-mtproto-smoke.db";
process.env.PORT = process.env.PORT ?? "8798";
const base = `http://127.0.0.1:${process.env.PORT}`;
const deviceId = "mtproto-smoke";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => rl.question(q);

async function post(path: string, body: unknown, secret?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main() {
  await import("./index.js");
  await new Promise((r) => setTimeout(r, 800));

  // 1) start login → code
  const start = await post("/auth/start", { deviceId, phone: PHONE });
  if (!start.ok) throw new Error(`/auth/start failed: ${JSON.stringify(start)}`);
  const secret = start.deviceSecret as string;
  console.log("✓ code requested — check your Telegram app");

  const code = (await ask("enter login code: ")).trim();
  let signed = await post("/auth/code", { deviceId, code }, secret);
  if (signed.ok && signed.needs2fa) {
    const pw = (await ask("2FA cloud password: ")).trim();
    signed = await post("/auth/2fa", { deviceId, password: pw }, secret);
  }
  if (!signed.ok || !signed.signedIn) throw new Error(`sign-in failed: ${JSON.stringify(signed)}`);
  console.log(`✓ signed in as tgUserId=${signed.tgUserId}`);

  // 2) resolve the target bot + subscribe (so /pull + push targets resolve)
  const resolved = await post("/peers/resolve", { deviceId, username: BOT_USERNAME }, secret);
  if (!resolved.ok) throw new Error(`resolve failed: ${JSON.stringify(resolved)}`);
  const peer = resolved.peer as { peerId: number; username: string; title: string };
  console.log(`✓ resolved @${peer.username} (${peer.title}) id=${peer.peerId}`);

  await post(
    "/register",
    {
      deviceId,
      expoPushToken: "ExponentPushToken[mtproto-smoke-fake]",
      platform: "ios",
      gateway: "https://api.telegram.org",
      bots: [{ buddyId: `buddy-${peer.peerId}`, botId: peer.peerId }],
    },
    secret,
  );

  // 3) send AS the user
  const sent = await post("/send", { deviceId, peerId: peer.peerId, text: "ping from mtproto smoke ✅" }, secret);
  if (!sent.ok) throw new Error(`send failed: ${JSON.stringify(sent)}`);
  console.log(`✓ sent message id=${sent.messageId} — it should appear in your Telegram FROM YOU`);
  console.log("  waiting for the bot to reply…");

  // 4) poll /pull for the bot's reply (buffered by the NewMessage handler)
  const auth = { Authorization: `Bearer ${secret}` };
  let since = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pull = (await (
      await fetch(`${base}/pull?deviceId=${deviceId}&botId=${peer.peerId}&since=${since}`, { headers: auth })
    ).json()) as { updates: { update_id: number; message?: { text?: string } }[]; cursor: number };
    if (pull.updates.length) {
      for (const u of pull.updates) console.log("   ← bot reply:", JSON.stringify(u.message?.text));
      since = pull.cursor + 1; // next-expected id (relay pull is >= since)
      console.log("\n✓ MTPROTO SMOKE PASSED");
      rl.close();
      process.exit(0);
    }
    console.log(`  waiting… (${i + 1}/30)`);
  }
  console.log("✗ no reply received within timeout (did the bot reply?)");
  rl.close();
  process.exit(1);
}

void main();
