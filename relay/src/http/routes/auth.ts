import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { hashSecret, newSecret } from "../../crypto.js";
import { mtproto } from "../../mtproto.js";
import { store } from "../../store.js";
import type { Auth2faBody, AuthCodeBody, AuthStartBody } from "../../types.js";
import { replyError, requireDeviceAuth } from "../guards.js";
import { mtprotoErr } from "../mtprotoError.js";

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/start", async (req, reply) => {
    if (!config.mtprotoEnabled) return reply.code(503).send({ ok: false, error: "mtproto_disabled" });
    const body = req.body as AuthStartBody;
    if (!body?.deviceId || !body?.phone) return replyError(reply, 400, "bad request");

    let secret: string | undefined;
    const existing = store.getDevice(body.deviceId);
    if (existing) {
      if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    } else {
      secret = newSecret();
      store.upsertDevice({ deviceId: body.deviceId, secretHash: hashSecret(secret), expoPushToken: "", platform: "ios" });
    }

    try {
      await mtproto.startLogin(body.deviceId, body.phone);
    } catch (e) {
      return mtprotoErr(reply, e);
    }
    return reply.send({ ok: true, ...(secret ? { deviceSecret: secret } : {}), needsCode: true });
  });

  app.post("/auth/code", async (req, reply) => {
    const body = req.body as AuthCodeBody;
    if (!body?.deviceId || !body?.code) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const r = await mtproto.confirmCode(body.deviceId, body.code);
      return reply.send({ ok: true, signedIn: r.signedIn, needs2fa: !r.signedIn, tgUserId: r.tgUserId });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.post("/auth/2fa", async (req, reply) => {
    const body = req.body as Auth2faBody;
    if (!body?.deviceId || !body?.password) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const tgUserId = await mtproto.confirm2fa(body.deviceId, body.password);
      return reply.send({ ok: true, signedIn: true, tgUserId });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = req.body as { deviceId?: string };
    if (!body?.deviceId) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    await mtproto.logout(body.deviceId);
    return reply.send({ ok: true });
  });

  app.get("/auth/status", async (req, reply) => {
    const q = req.query as { deviceId?: string };
    const deviceId = q.deviceId ?? "";
    if (!deviceId) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, deviceId, reply)) return;
    const s = store.getUserSession(deviceId);
    const live = mtproto.isSignedIn(deviceId);
    return reply.send({
      ok: true,
      status: s?.status ?? "none",
      connected: live,
      tgUserId: s?.tg_user_id ?? undefined,
      phone: s?.phone ?? undefined,
    });
  });
}
