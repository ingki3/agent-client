/**
 * MCP server exposing phone-control tools. One server instance per authenticated
 * session, bound to that client's (deviceId, peerId), so a tool call always
 * targets the right phone.
 *
 * Every tool is a thin cap over dispatchCommand: it forwards args to the phone,
 * which executes natively and returns a result. Phase 1: get_location.
 * Phase 2 (SENSE): read_sms, find_contact, list_media, fetch_media.
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dispatchCommand } from "../commands/dispatcher.js";
import { log } from "../log.js";
import { mtproto } from "../mtproto.js";
import { store } from "../store.js";
import type { McpIdentity } from "./auth.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function runTool(identity: McpIdentity, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await dispatchCommand(identity.deviceId, identity.peerId, tool, args);
  if (!res.ok) {
    return { content: [{ type: "text", text: `error: ${res.error ?? "unknown"}` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(res.result) }] };
}

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
    () => runTool(identity, "get_location", {}),
  );

  server.registerTool(
    "read_sms",
    {
      title: "Read SMS messages",
      description:
        "Read recent SMS messages from the phone (inbox + sent). Optionally filter by a phone " +
        "number/address. Returns the most recent messages first. Runs silently in the background.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional().describe("Max messages to return (default 20)."),
        address: z.string().optional().describe("Only messages to/from this phone number."),
      },
    },
    (args) => runTool(identity, "read_sms", args as Record<string, unknown>),
  );

  server.registerTool(
    "find_contact",
    {
      title: "Find a contact",
      description:
        "Look up phone numbers for a contact by name (partial match). Use this to resolve a name " +
        "to a number before sending an SMS. Runs silently in the background.",
      inputSchema: {
        name: z.string().min(1).describe("Contact name to search for (partial match)."),
      },
    },
    (args) => runTool(identity, "find_contact", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_media",
    {
      title: "List recent media",
      description:
        "List recent photos or videos on the phone (metadata only: a ref, name, mime, size, date). " +
        "Use the ref with fetch_media to get the actual bytes. Runs silently in the background.",
      inputSchema: {
        type: z.enum(["image", "video"]).optional().describe("Media type (default image)."),
        limit: z.number().int().positive().max(100).optional().describe("Max items (default 20)."),
      },
    },
    (args) => runTool(identity, "list_media", args as Record<string, unknown>),
  );

  server.registerTool(
    "fetch_media",
    {
      title: "Fetch media bytes",
      description:
        "Fetch the actual bytes of one media item (base64) by the ref from list_media — for vision " +
        "analysis or forwarding. Bounded in size. Runs silently in the background.",
      inputSchema: {
        ref: z.string().min(1).describe("The media ref (content URI) returned by list_media."),
      },
    },
    (args) => runTool(identity, "fetch_media", args as Record<string, unknown>),
  );

  // ─── ACTION tools (Phase 3) ────────────────────────────────────────────────
  // Writes are irreversible and go out under the user's identity. The bot is
  // expected to confirm with the user in chat before calling these; every call
  // is audited in mcp_tool_calls.

  server.registerTool(
    "send_sms",
    {
      title: "Send an SMS",
      description:
        "Send an SMS from the phone to a number. IRREVERSIBLE — it goes out on the user's own SIM/number. " +
        "Confirm with the user before calling. Use find_contact first to resolve a name to a number.",
      inputSchema: {
        to: z.string().min(1).describe("Recipient phone number (E.164 or local)."),
        body: z.string().min(1).describe("Message text."),
      },
    },
    (args) => runTool(identity, "send_sms", args as Record<string, unknown>),
  );

  server.registerTool(
    "send_media",
    {
      title: "Send media to Telegram",
      description:
        "Send a photo/video/file from the phone (by a list_media ref) into the Telegram conversation. " +
        "The phone supplies the bytes; the relay sends it via the user's Telegram account.",
      inputSchema: {
        ref: z.string().min(1).describe("The media ref (content URI) from list_media."),
        caption: z.string().optional().describe("Optional caption."),
      },
    },
    async ({ ref, caption }) => {
      const correlationId = randomUUID();
      const argsJson = JSON.stringify({ ref, caption });
      store.insertToolCall({ correlationId, deviceId: identity.deviceId, peerId: identity.peerId, tool: "send_media", argsJson });
      try {
        const fetched = await dispatchCommand(identity.deviceId, identity.peerId, "fetch_media", { ref });
        if (!fetched.ok) {
          store.finishToolCall(correlationId, "error", JSON.stringify(fetched));
          return { content: [{ type: "text", text: `error: ${fetched.error ?? "fetch_failed"}` }], isError: true };
        }
        const media = fetched.result as { mime?: string; name?: string; base64?: string };
        if (!media?.base64) {
          store.finishToolCall(correlationId, "error", null);
          return { content: [{ type: "text", text: "error: media_empty" }], isError: true };
        }
        const buffer = Buffer.from(media.base64, "base64");
        const mime = media.mime ?? "application/octet-stream";
        const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "document";
        const messageId = await mtproto.sendMediaAs(identity.deviceId, identity.peerId, {
          buffer,
          fileName: media.name ?? "file",
          mime,
          kind,
          ...(caption ? { caption } : {}),
        });
        store.finishToolCall(correlationId, "done", JSON.stringify({ ok: true, result: { messageId } }));
        log.info(`send_media done corr=${correlationId} peer=${identity.peerId} messageId=${messageId}`);
        return { content: [{ type: "text", text: JSON.stringify({ messageId }) }] };
      } catch (e) {
        store.finishToolCall(correlationId, "error", null);
        return { content: [{ type: "text", text: `error: send_media_failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
    },
  );

  return server;
}
