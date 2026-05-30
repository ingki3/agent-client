/**
 * Deterministic unit check of the store buffer + /pull cursor logic + token encryption.
 * No network/bot needed. Run: RELAY_DB=/tmp/relay-unit.db node --import tsx src/store.test.ts
 */
import { store } from "./store.js";
import { encrypt, decrypt, newSecret, hashSecret, secretMatches } from "./crypto.js";
import type { TgUpdate } from "./types.js";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
  cond ? ok++ : bad++;
};

console.log("\n== Relay store/crypto unit ==\n");

// crypto round-trip + secret
const tok = "123456789:ABCdef-the-secret-token-xyz1234567890";
check("token encrypt→decrypt round-trips", decrypt(encrypt(tok)) === tok);
check("ciphertext is not plaintext", encrypt(tok) !== tok && !encrypt(tok).includes("ABCdef"));
const sec = newSecret();
check("deviceSecret matches its hash", secretMatches(sec, hashSecret(sec)));
check("wrong secret rejected", !secretMatches("nope", hashSecret(sec)));

// register a device + bot, then buffer updates and pull by cursor
store.upsertDevice({ deviceId: "d1", secretHash: hashSecret(sec), expoPushToken: "ExponentPushToken[x]", platform: "ios" });
store.upsertBot({ botId: 999, gateway: "https://api.telegram.org", botToken: tok });
store.subscribe("d1", 999, "buddy-999");

const mk = (uid: number, text: string): TgUpdate => ({
  update_id: uid,
  message: { message_id: uid, date: 1730000000, text, chat: { id: 42, type: "private" } },
});
store.insertUpdate(999, mk(10, "first"));
store.insertUpdate(999, mk(11, "second"));
store.insertUpdate(999, mk(10, "dup")); // duplicate update_id → ignored

const all = store.pullUpdates(999, 0);
check("pull since=0 returns 2 (dup ignored)", all.length === 2);
check("pull is ordered by update_id", all[0]!.update_id === 10 && all[1]!.update_id === 11);
check("decrypted token usable for poll", store.decryptToken({ bot_id: 999, gateway: "", enc_bot_token: encrypt(tok), tg_offset: 0, status: "active" }) === tok);

const cursor = all[all.length - 1]!.update_id;
check("re-pull at cursor is empty (idempotent)", store.pullUpdates(999, cursor).length === 0);

// push targets resolve the device's expo token + buddy
const targets = store.pushTargets(999);
check("pushTargets resolves device", targets.length === 1 && targets[0]!.buddy_id === "buddy-999");

// unsubscribe → reap orphan bot → token gone
store.unsubscribe("d1", 999);
const reaped = store.reapOrphanBots();
check("orphan bot reaped on last unsubscribe", reaped.includes(999));

console.log(`\n== ${ok} passed, ${bad} failed ==\n`);
process.exit(bad > 0 ? 1 : 0);
