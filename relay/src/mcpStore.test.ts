/**
 * Unit checks for the MCP command-pipe store methods (mcp_clients + mcp_tool_calls).
 * Run: node --import tsx src/mcpStore.test.ts
 */
import { unlinkSync } from "node:fs";

const testDb = `/tmp/agent-client-relay-mcpstore-test-${process.pid}.db`;
try {
  unlinkSync(testDb);
} catch {
  // absent is fine
}
process.env.RELAY_DB = testDb;
const { store } = await import("./store.js");
const { hashSecret } = await import("./crypto.js");

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
  cond ? ok++ : bad++;
};

console.log("\n== MCP client tokens ==\n");
const tokenHash = hashSecret("test-token-abc");
store.insertMcpClient({ tokenHash, deviceId: "dev-1", peerId: 8260889964, label: "test" });
const client = store.getMcpClientByTokenHash(tokenHash);
check("client resolves token hash → device + peer", client?.device_id === "dev-1" && client?.peer_id === 8260889964);
check("unknown token hash returns undefined", store.getMcpClientByTokenHash(hashSecret("nope")) === undefined);
store.insertMcpClient({ tokenHash, deviceId: "dev-2", peerId: 5, label: "reissued" });
check("re-mint with same hash updates binding", store.getMcpClientByTokenHash(tokenHash)?.device_id === "dev-2");

console.log("\n== tool-call audit lifecycle ==\n");
store.insertToolCall({ correlationId: "c1", deviceId: "dev-1", peerId: 1, tool: "get_location", argsJson: "{}" });
check("insert → pending", store.getToolCall("c1")?.status === "pending");
check("pending count reflects open call", store.pendingToolCallCount() === 1);
store.finishToolCall("c1", "done", JSON.stringify({ ok: true, result: { lat: 1 } }));
check("finish → done", store.getToolCall("c1")?.status === "done");
check("pending count drops after finish", store.pendingToolCallCount() === 0);
store.finishToolCall("c1", "timeout", null);
check("finish is idempotent (only settles a pending row)", store.getToolCall("c1")?.status === "done");

store.insertToolCall({ correlationId: "c2", deviceId: "dev-1", peerId: 1, tool: "get_location", argsJson: "{}" });
store.finishToolCall("c2", "timeout", null);
check("timeout path recorded", store.getToolCall("c2")?.status === "timeout");

console.log(`\n${ok} ok, ${bad} failed\n`);
if (bad > 0) process.exit(1);
