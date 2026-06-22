/**
 * Shared HTTP guards — consistent error responses + device auth.
 *
 * Every relay error reply has the shape `{ ok: false, error, ...extra }`;
 * `replyError` is the one place that shapes it. `requireDeviceAuth` runs the
 * Bearer-secret check and, on failure, sends 401 and returns false so the
 * handler can `if (!requireDeviceAuth(...)) return;`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

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
