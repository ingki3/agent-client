import type { FastifyInstance } from "fastify";
import { hashSecret, newSecret } from "../../crypto.js";
import { log } from "../../log.js";
import { loopCount, reconcileLoops } from "../../poller.js";
import { store } from "../../store.js";
import type { RegisterBody } from "../../types.js";
import { authDevice } from "../authDevice.js";

export function registerSystemRoutes(app: FastifyInstance) {
  app.post("/register", async (req, reply) => {
    const body = req.body as RegisterBody;
    if (!body?.deviceId || !body?.gateway || !Array.isArray(body?.bots)) {
      return reply.code(400).send({ ok: false, error: "bad request" });
    }

    const existing = store.getDevice(body.deviceId);
    let secret: string | undefined;
    let secretHash: string;
    if (existing) {
      if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
      secretHash = existing.device_secret_hash;
    } else {
      secret = newSecret();
      secretHash = hashSecret(secret);
    }

    store.upsertDevice({
      deviceId: body.deviceId,
      secretHash,
      expoPushToken: body.expoPushToken ?? "",
      platform: body.platform === "android" ? "android" : "ios",
    });

    const registered: string[] = [];
    for (const b of body.bots) {
      if (!b?.botId || !b?.buddyId) continue;
      if (b.botToken) store.upsertBot({ botId: b.botId, gateway: body.gateway, botToken: b.botToken });
      store.subscribe(body.deviceId, b.botId, b.buddyId);
      registered.push(b.buddyId);
    }

    reconcileLoops();
    log.info(
      `register device=${body.deviceId} platform=${body.platform === "android" ? "android" : "ios"} bots=${registered.length} push_token_len=${(body.expoPushToken ?? "").length}`,
    );
    return reply.send({ ok: true, ...(secret ? { deviceSecret: secret } : {}), registered });
  });

  app.post("/unregister", async (req, reply) => {
    const body = req.body as { deviceId: string; botId?: number };
    if (!body?.deviceId) return reply.code(400).send({ ok: false, error: "bad request" });
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });

    if (body.botId == null) store.removeDevice(body.deviceId);
    else store.unsubscribe(body.deviceId, body.botId);

    reconcileLoops();
    log.info(`unregister device=${body.deviceId} bot=${body.botId ?? "ALL"}`);
    return reply.send({ ok: true });
  });

  app.get("/pull", async (req, reply) => {
    const q = req.query as { deviceId?: string; botId?: string; since?: string };
    const deviceId = q.deviceId ?? "";
    const botId = Number(q.botId);
    const since = Number(q.since ?? 0);
    if (!deviceId || !Number.isFinite(botId)) return reply.code(400).send({ ok: false, error: "bad request" });
    if (!authDevice(req, deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    if (!store.subscriptionBuddy(deviceId, botId)) return reply.code(403).send({ ok: false, error: "not subscribed" });

    const updates = store.pullUpdates(botId, since);
    const cursor = updates.length ? updates[updates.length - 1]!.update_id : since;
    return reply.send({ ok: true, updates, cursor });
  });

  app.get("/health", async () => {
    return { ok: true, loops: loopCount(), ...store.healthSnapshot() };
  });
}
