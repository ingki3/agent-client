/**
 * Unit checks for the pending clientTag registry + snapshot clientTag round-trip.
 * Run: node --import tsx src/clientTags.test.ts
 */
import { unlinkSync } from "node:fs";

const testDb = `/tmp/agent-client-relay-clienttags-test-${process.pid}.db`;
try {
  unlinkSync(testDb);
} catch {
  // absent is fine
}
process.env.RELAY_DB = testDb;
const { clientTags } = await import("./clientTags.js");
const { store } = await import("./store.js");

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
  cond ? ok++ : bad++;
};

console.log("\n== clientTags registry ==\n");

clientTags._reset();
clientTags.register("dev-1", 100, "hello world", "tag-a");
check("exact-text match consumes the tag", clientTags.matchOutgoing("dev-1", 100, "hello world") === "tag-a");
check("consumed tag does not match twice", clientTags.matchOutgoing("dev-1", 100, "hello world") === undefined);

clientTags._reset();
clientTags.register("dev-1", 100, "hello   world\n", "tag-b");
check("whitespace-compacted text matches", clientTags.matchOutgoing("dev-1", 100, "hello world") === "tag-b");

clientTags._reset();
clientTags.register("dev-1", 100, "original text", "tag-c");
check(
  "single-pending fallback matches normalized text",
  clientTags.matchOutgoing("dev-1", 100, "telegram rewrote this") === "tag-c",
);

clientTags._reset();
clientTags.register("dev-1", 100, "text one", "tag-d");
clientTags.register("dev-1", 100, "text two", "tag-e");
check(
  "no fallback when several pending tags exist and none match",
  clientTags.matchOutgoing("dev-1", 100, "different") === undefined,
);
check("exact match still works among several", clientTags.matchOutgoing("dev-1", 100, "text two") === "tag-e");

clientTags._reset();
clientTags.register("dev-1", 100, "same text", "tag-f");
clientTags.register("dev-1", 100, "same text", "tag-g");
check("duplicate texts match oldest first (FIFO)", clientTags.matchOutgoing("dev-1", 100, "same text") === "tag-f");
check("second duplicate matches the remaining tag", clientTags.matchOutgoing("dev-1", 100, "same text") === "tag-g");

clientTags._reset();
clientTags.register("dev-1", 100, "scoped", "tag-h");
check("different device does not match", clientTags.matchOutgoing("dev-2", 100, "scoped") === undefined);
check("different peer does not match", clientTags.matchOutgoing("dev-1", 200, "scoped") === undefined);

clientTags._reset();
clientTags.register("dev-1", 100, "to discard", "tag-i");
clientTags.discard("tag-i");
check("discarded tag does not match", clientTags.matchOutgoing("dev-1", 100, "to discard") === undefined);

console.log("\n== snapshot clientTag round-trip ==\n");

const base = {
  id: "9001",
  peerId: 100,
  messageId: 9001,
  role: "user" as const,
  text: "hello world",
  status: "complete" as const,
  date: 1_780_000_000,
};

const first = store.upsertMessageSnapshot({ ...base, clientTag: "tag-rt" });
check("insert with clientTag reports changed", first.changed);
const read = store.getMessageSnapshot(100, 9001);
check("clientTag round-trips through payload_json", read?.clientTag === "tag-rt");

const stampLater = store.upsertMessageSnapshot({ ...base, id: "9002", messageId: 9002 });
check("insert without clientTag works", stampLater.changed && stampLater.message.clientTag === undefined);
const stamped = store.upsertMessageSnapshot({ ...base, id: "9002", messageId: 9002, clientTag: "tag-late" });
check("stamping a tag on an existing snapshot reports changed", stamped.changed);
check("stamp bumps the per-peer cursor", stamped.message.cursor > stampLater.message.cursor);
check("stamped tag persists", store.getMessageSnapshot(100, 9002)?.clientTag === "tag-late");

const noop = store.upsertMessageSnapshot({ ...base, id: "9002", messageId: 9002, clientTag: "tag-late" });
check("re-upsert with same tag is a no-op", !noop.changed);

const untouched = store.upsertMessageSnapshot({ ...base, id: "9002", messageId: 9002, text: "hello world edited", clientTag: "tag-late" });
check("edit keeps the tag", untouched.message.clientTag === "tag-late" && untouched.changed);

console.log(`\n${ok} ok, ${bad} failed\n`);
if (bad > 0) process.exit(1);
