/**
 * POST /command/result — the phone's callback leg of the command pipe.
 *
 * The background command executor on the phone POSTs here (Bearer deviceSecret)
 * with the correlationId it received via FCM and the tool's result. The relay
 * matches it to the waiting dispatchCommand promise.
 */
import type { FastifyInstance } from "fastify";
import { resolveCommand } from "../../commands/dispatcher.js";
import { replyError, requireDeviceAuth } from "../guards.js";

export function registerCommandResultRoutes(app: FastifyInstance) {
  app.post("/command/result", async (req, reply) => {
    const body = req.body as {
      deviceId?: string;
      correlationId?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (!body?.deviceId || !body?.correlationId) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;

    const matched = resolveCommand(body.correlationId, {
      ok: body.ok !== false,
      result: body.result,
      ...(body.error ? { error: body.error } : {}),
    });
    // Even an unmatched (late/duplicate) result is a 200 — the phone did its job.
    return reply.send({ ok: true, matched });
  });
}
