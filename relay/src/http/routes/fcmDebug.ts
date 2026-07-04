/**
 * Dev-only debug routes to prove the wake channel in isolation (Phase 0 spike):
 *   POST /debug/fcm-ping  (master-key)  → send a data-only FCM to a device
 *   POST /debug/echo      (device-auth) → the phone's callback target
 *
 * Both are gated: fcm-ping needs the master key, echo needs the device secret.
 * They exist to verify "relay wakes killed app → app POSTs back" before any MCP.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { fcm } from "../../fcm/fcmSender.js";
import { log } from "../../log.js";
import { store } from "../../store.js";
import { replyError, requireDeviceAuth, requireMasterKey } from "../guards.js";

export function registerFcmDebugRoutes(app: FastifyInstance) {
  app.post("/debug/fcm-ping", async (req, reply) => {
    if (!requireMasterKey(req, reply)) return;
    const body = req.body as { deviceId?: string };
    if (!body?.deviceId) return replyError(reply, 400, "bad request");
    const device = store.getDevice(body.deviceId);
    if (!device) return replyError(reply, 404, "device not found");
    if (!device.fcm_token) return replyError(reply, 409, "device has no fcm token");
    if (!fcm.enabled) return replyError(reply, 503, "fcm not configured (FCM_SERVICE_ACCOUNT_JSON)");

    const correlationId = randomUUID();
    try {
      await fcm.sendCommand(device.fcm_token, { correlationId, tool: "ping", args: "{}" });
    } catch (e) {
      return replyError(reply, 502, `fcm send failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return reply.send({ ok: true, correlationId });
  });

  app.post("/debug/echo", async (req, reply) => {
    const body = req.body as { deviceId?: string; correlationId?: string; note?: string };
    if (!body?.deviceId) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    log.info(`debug/echo device=${body.deviceId} corr=${body.correlationId ?? "-"} note=${body.note ?? "-"}`);
    return reply.send({ ok: true });
  });
}
