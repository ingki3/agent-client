/**
 * MCP client auth. The reasoning bot presents `Authorization: Bearer <mcpToken>`;
 * we resolve it (via its deterministic sha256 hash) to the phone (deviceId) and
 * Telegram peer it is allowed to act on. A separate principal from the phone's
 * deviceSecret — mint tokens with scripts/mint-mcp-token.ts.
 */
import { hashSecret } from "../crypto.js";
import { store } from "../store.js";

export interface McpIdentity {
  deviceId: string;
  peerId: number;
}

export function authMcpToken(authHeader: string | undefined): McpIdentity | null {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const row = store.getMcpClientByTokenHash(hashSecret(token));
  if (!row) return null;
  return { deviceId: row.device_id, peerId: row.peer_id };
}
