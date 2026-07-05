/**
 * MCP endpoint (Streamable HTTP transport) mounted on Fastify.
 *
 * POST /mcp  — JSON-RPC (initialize + tool calls). A new session is created on
 *              initialize (authenticated by Bearer mcp token); subsequent calls
 *              reuse the transport by mcp-session-id.
 * GET  /mcp  — the server→client SSE stream leg for a session.
 * DELETE /mcp — session teardown.
 *
 * Every request must carry a valid Bearer mcp token (not just the session id).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "../../log.js";
import { authMcpToken } from "../../mcp/auth.js";
import { buildMcpServer } from "../../mcp/server.js";

const transports = new Map<string, StreamableHTTPServerTransport>();

export function registerMcpRoutes(app: FastifyInstance) {
  app.post("/mcp", async (req, reply) => {
    const identity = authMcpToken(req.headers["authorization"]);
    if (!identity) return reply.code(401).send({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null });

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      // No session yet — this must be an initialize request. Spin up a transport
      // + server bound to this client's phone.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Tools are request/response (no server-initiated streaming), so return
        // plain JSON on POST instead of an SSE stream — simpler for clients.
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
          log.info(`mcp session opened sid=${sid} device=${identity.deviceId} peer=${identity.peerId}`);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildMcpServer(identity);
      await server.connect(transport);
    }

    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const streamOrDelete = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authMcpToken(req.headers["authorization"])) return reply.code(401).send({ ok: false, error: "unauthorized" });
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return reply.code(400).send({ ok: false, error: "unknown session" });
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw);
  };

  app.get("/mcp", streamOrDelete);
  app.delete("/mcp", streamOrDelete);
}
