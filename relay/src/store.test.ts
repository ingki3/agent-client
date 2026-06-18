/**
 * Deterministic unit check of the store buffer + /pull cursor logic + token encryption.
 * No network/bot needed. Run: RELAY_DB=/tmp/relay-unit.db node --import tsx src/store.test.ts
 */
import { unlinkSync } from "node:fs";
import type { TgUpdate } from "./types.js";

const testDb = `/tmp/agent-client-relay-store-test-${process.pid}.db`;
try {
  unlinkSync(testDb);
} catch {
  // absent is fine
}
process.env.RELAY_DB = testDb;
const { encrypt, decrypt, newSecret, hashSecret, secretMatches } = await import("./crypto.js");
const { store } = await import("./store.js");

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

// `since` is the next-expected id (client sends last+1), so re-pull at cursor+1 is empty.
const cursor = all[all.length - 1]!.update_id;
check("re-pull past cursor is empty (idempotent)", store.pullUpdates(999, cursor + 1).length === 0);
check("re-pull AT last id re-returns it (inclusive >=)", store.pullUpdates(999, cursor).length === 1);

// push targets resolve the device's expo token + buddy
const targets = store.pushTargets(999);
check("pushTargets resolves device", targets.length === 1 && targets[0]!.buddy_id === "buddy-999");

// unsubscribe → reap orphan bot → token gone
store.unsubscribe("d1", 999);
const reaped = store.reapOrphanBots();
check("orphan bot reaped on last unsubscribe", reaped.includes(999));

// ── MTProto user-session + peer cursor ──
const fakeSession = "1AaBbCc-fake-string-session-payload-0987654321";
store.upsertUserSession({ deviceId: "d1", phone: "+10000000000", status: "pending" });
check("user session created pending", store.getUserSession("d1")?.status === "pending");
store.setSessionString("d1", fakeSession, 555);
const sess = store.getUserSession("d1");
check("session activates with tgUserId", sess?.status === "active" && sess?.tg_user_id === 555);
check("session string encrypted at rest", !!sess?.enc_session && !sess.enc_session.includes(fakeSession));
check("session decrypts back", store.decryptSession(sess!) === fakeSession);
check("activeSessions returns it", store.activeSessions().some((s) => s.device_id === "d1"));
store.upsertUserSession({ deviceId: "d2", phone: "+100****0000", status: "pending" });
store.setSessionString("d2", `${fakeSession}-newer`, 555);
check("new login revokes older active session for same Telegram account", store.getUserSession("d1")?.status === "revoked" && !store.getUserSession("d1")?.enc_session);
check("activeSessions keeps latest device per Telegram account", store.activeSessions().filter((s) => s.tg_user_id === 555).map((s) => s.device_id).join(",") === "d2");

// peer + monotonic per-peer cursor (the getUpdates-offset stand-in)
store.upsertPeer({ deviceId: "d1", peerId: 7001, username: "agentbot", title: "Agent", accessHash: "123" });
store.upsertPeer({ deviceId: "d1", peerId: 7002, username: "otherbot", title: "Other" });
const s1 = store.nextPeerSeq("d1", 7001);
const s2 = store.nextPeerSeq("d1", 7001);
const o1 = store.nextPeerSeq("d1", 7002);
check("nextPeerSeq strictly increases per peer", s1 === 1 && s2 === 2);
check("nextPeerSeq isolated across peers", o1 === 1);

// an MTProto-shaped update buffers + pulls via the SAME store path as bot updates
store.subscribe("d1", 7001, "buddy-7001");
store.insertUpdate(7001, mk(1, "reply from bot as agent"));
const mtPulled = store.pullUpdates(7001, 0);
check("MTProto update buffered + pulled by cursor", mtPulled.length === 1 && mtPulled[0]!.message?.text === "reply from bot as agent");

const snap1 = store.upsertMessageSnapshot({
  id: "1",
  peerId: 7001,
  messageId: 1,
  role: "agent",
  text: "partial",
  status: "streaming",
  date: 1730000000,
});
const snap2 = store.upsertMessageSnapshot({
  id: "1",
  peerId: 7001,
  messageId: 1,
  role: "agent",
  text: "final",
  status: "complete",
  date: 1730000000,
});
const snapList = store.listMessageSnapshots(7001, 0);
check("message snapshot upsert keeps one row", snapList.length === 1 && snapList[0]!.text === "final");
check("message snapshot cursor advances on change", snap1.message.cursor === 1 && snap2.message.cursor === 2);
const helper = store.mergeSnapshotHelperItems(7001, 1, [{ type: "quick_replies", id: "h1", options: [{ label: "More", value: "Tell me more" }] }]);
check("helper items merge into message snapshot", !!helper?.message.helperItems?.length && store.listMessageSnapshots(7001, 0)[0]!.helperItems?.[0]?.id === "h1");

store.revokeSession("d1");
check("revokeSession clears session string", store.getUserSession("d1")?.status === "revoked" && !store.getUserSession("d1")?.enc_session);

console.log(`\n== ${ok} passed, ${bad} failed ==\n`);
process.exit(bad > 0 ? 1 : 0);
