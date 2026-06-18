/**
 * Live smoke test for the relay. Boots an in-process relay (random temp DB),
 * registers a real bot token, then waits for the operator to message the bot and
 * verifies the poll loop buffers the update and /pull returns it.
 *
 * Usage: RELAY_DB=/tmp/relay-smoke.db node --import tsx src/smoke.ts <botToken> [gateway]
 * (push send will be attempted with a fake Expo token and is expected to be pruned;
 *  the buffer + /pull path is what this verifies without a device.)
 */
const [, , BOT_TOKEN, GATEWAY = "https://api.telegram.org"] = process.argv;
if (!BOT_TOKEN) {
  console.error("usage: node --import tsx src/smoke.ts <botToken> [gateway]");
  process.exit(1);
}

process.env.RELAY_DB = process.env.RELAY_DB ?? "/tmp/relay-smoke.db";
process.env.PORT = process.env.PORT ?? "8799";

const base = `http://127.0.0.1:${process.env.PORT}`;

async function main() {
  await import("./index.js"); // boots the server
  await new Promise((r) => setTimeout(r, 800));

  // getMe to learn botId
  const me = (await (await fetch(`${GATEWAY}/bot${BOT_TOKEN}/getMe`, { method: "POST" })).json()) as {
    ok: boolean;
    result?: { id: number; first_name: string; username?: string };
  };
  if (!me.ok || !me.result) throw new Error("getMe failed — bad token?");
  const botId = me.result.id;
  console.log(`bot: ${me.result.first_name} (@${me.result.username}) id=${botId}`);

  const deviceId = "smoke-device";
  const reg = (await (
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        expoPushToken: "ExponentPushToken[smoke-fake]",
        platform: "ios",
        gateway: GATEWAY,
        bots: [{ buddyId: `buddy-${botId}`, botToken: BOT_TOKEN, botId }],
      }),
    })
  ).json()) as { ok: boolean; deviceSecret?: string };
  if (!reg.ok || !reg.deviceSecret) throw new Error("register failed");
  const secret = reg.deviceSecret;
  console.log("✓ registered; poll loop running. Now SEND A MESSAGE to the bot from Telegram.");

  const auth = { Authorization: `Bearer ${secret}` };
  let since = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pull = (await (
      await fetch(`${base}/pull?deviceId=${deviceId}&botId=${botId}&since=${since}`, { headers: auth })
    ).json()) as { ok: boolean; updates: { update_id: number; message?: { text?: string } }[]; cursor: number };
    if (pull.updates.length) {
      console.log(`✓ /pull returned ${pull.updates.length} update(s):`);
      for (const u of pull.updates) console.log("   →", JSON.stringify(u.message?.text));
      since = pull.cursor + 1; // next-expected id (relay pull is >= since)
      // idempotency: re-pull at the new cursor should be empty
      const again = (await (
        await fetch(`${base}/pull?deviceId=${deviceId}&botId=${botId}&since=${since}`, { headers: auth })
      ).json()) as { updates: unknown[] };
      console.log(again.updates.length === 0 ? "✓ cursor idempotent (re-pull empty)" : "✗ re-pull not empty");
      console.log("\n✓ SMOKE PASSED");
      process.exit(0);
    }
    console.log(`  waiting for a message… (${i + 1}/30)`);
  }
  console.log("✗ no message received within timeout");
  process.exit(1);
}

void main();
