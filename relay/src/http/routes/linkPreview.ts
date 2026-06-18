import type { FastifyInstance } from "fastify";
import { log } from "../../log.js";
import { fetchLinkPreview } from "../../services/linkPreview.js";
import { authDevice } from "../authDevice.js";

export function registerLinkPreviewRoutes(app: FastifyInstance) {
  app.post("/link/preview", async (req, reply) => {
    const body = req.body as { deviceId?: string; url?: string };
    if (!body?.deviceId || !body?.url) return reply.code(400).send({ ok: false, error: "bad request" });
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    try {
      const preview = await fetchLinkPreview(body.url);
      return reply.send({ ok: true, preview });
    } catch (e) {
      log.warn(`link preview failed url=${body.url} error=${(e as { message?: string })?.message ?? String(e)}`);
      return reply.send({ ok: false, error: "preview_failed" });
    }
  });
}
