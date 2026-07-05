/**
 * Mint an MCP client token bound to a phone (deviceId) + Telegram peer (peerId).
 * The bot presents this token as `Authorization: Bearer <token>` to /mcp.
 *
 * Usage:
 *   node --import tsx scripts/mint-mcp-token.ts <deviceId> <peerId> [label]
 *
 * Prints the token ONCE (only its hash is stored). Run against the same
 * RELAY_DB the relay uses.
 */
import { hashSecret, newSecret } from "../src/crypto.js";
import { store } from "../src/store.js";

const [deviceId, peerIdRaw, label] = process.argv.slice(2);
if (!deviceId || !peerIdRaw) {
  console.error("usage: mint-mcp-token.ts <deviceId> <peerId> [label]");
  process.exit(1);
}
const peerId = Number(peerIdRaw);
if (!Number.isFinite(peerId)) {
  console.error(`invalid peerId: ${peerIdRaw}`);
  process.exit(1);
}
if (!store.getDevice(deviceId)) {
  console.error(`warning: device '${deviceId}' not found in this DB (minting anyway)`);
}

const token = newSecret();
store.insertMcpClient({ tokenHash: hashSecret(token), deviceId, peerId, label });

console.log("MCP token minted (store it now — it is not recoverable):\n");
console.log(`  ${token}\n`);
console.log(`bound to device=${deviceId} peer=${peerId}${label ? ` label=${label}` : ""}`);
