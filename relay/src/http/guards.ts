/**
 * Shared HTTP guards — consistent error responses + device auth.
 *
 * Every relay error reply has the shape `{ ok: false, error, ...extra }`;
 * `replyError` is the one place that shapes it. `requireDeviceAuth` runs the
 * Bearer-secret check and, on failure, sends 401 and returns false so the
 * handler can `if (!requireDeviceAuth(...)) return;`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "../config.js";
import { authDevice } from "./authDevice.js";

export function replyError(
  reply: FastifyReply,
  code: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return reply.code(code).send({ ok: false, error, ...(extra ?? {}) });
}

export function requireDeviceAuth(req: FastifyRequest, deviceId: string, reply: FastifyReply): boolean {
  if (!authDevice(req, deviceId)) {
    void replyError(reply, 401, "unauthorized");
    return false;
  }
  return true;
}

/**
 * Guard admin/dev endpoints (debug pings, MCP-token minting) with the relay
 * master key via `Authorization: Bearer <RELAY_MASTER_KEY>`. Disabled entirely
 * when no master key is configured (dev-key mode) to avoid a false sense of auth.
 */
export function requireMasterKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = String(req.headers["authorization"] ?? "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!config.masterKeyRaw || provided !== config.masterKeyRaw) {
    void replyError(reply, 401, "unauthorized");
    return false;
  }
  return true;
}
