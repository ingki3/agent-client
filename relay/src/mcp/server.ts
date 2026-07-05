/**
 * MCP server exposing phone-control tools. One server instance per authenticated
 * session, bound to that client's (deviceId, peerId), so a tool call always
 * targets the right phone. Phase 1 registers only get_location.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatchCommand } from "../commands/dispatcher.js";
import type { McpIdentity } from "./auth.js";

export function buildMcpServer(identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "agentclient-phone", version: "0.1.0" });

  server.registerTool(
    "get_location",
    {
      title: "Get current location",
      description:
        "Read the phone's current GPS location, reverse-geocoded to a human-readable address. " +
        "Runs silently in the background — the phone does not need to be unlocked or in hand.",
      inputSchema: {},
    },
    async () => {
      const res = await dispatchCommand(identity.deviceId, identity.peerId, "get_location", {});
      if (!res.ok) {
        return { content: [{ type: "text", text: `error: ${res.error ?? "unknown"}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(res.result) }] };
    },
  );

  return server;
}
