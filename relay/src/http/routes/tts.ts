import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { waitForHelperIdle } from "../../helper/scheduler.js";
import { log } from "../../log.js";
import { createTtsAudio, createTtsScript, resolveTtsFile } from "../../tts.js";
import type { TtsBody, TtsMode } from "../../types.js";
import { authDevice } from "../authDevice.js";

function normalizeTtsMode(mode: unknown): TtsMode {
  return mode === "brief" || mode === "action_items" || mode === "explain" ? mode : "brief";
}

export function registerTtsRoutes(app: FastifyInstance) {
  app.post("/tts/script", async (req, reply) => {
    const body = req.body as TtsBody;
    if (!body?.deviceId || !body?.text) return reply.code(400).send({ ok: false, error: "bad request" });
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    try {
      const mode = normalizeTtsMode(body.mode);
      const waited = await waitForHelperIdle();
      if (waited.waitedMs > 0 || !waited.idle) {
        log.info(
          `tts script helper_wait device=${body.deviceId} message=${body.messageId ?? "none"} idle=${waited.idle} waited_ms=${waited.waitedMs} pending=${waited.pending} in_flight=${waited.inFlight}`,
        );
      }
      const script = await createTtsScript({ text: body.text, mode });
      log.info(`tts script device=${body.deviceId} message=${body.messageId ?? "none"} mode=${mode} chars=${script.length}`);
      return reply.send({ ok: true, script, mode });
    } catch (e) {
      log.warn(`tts script failed device=${body.deviceId} message=${body.messageId ?? "none"} error=${(e as { message?: string })?.message ?? String(e)}`);
      return reply.send({ ok: false, error: "tts_failed" });
    }
  });

  app.post("/tts/audio", async (req, reply) => {
    const body = req.body as TtsBody;
    if (!body?.deviceId || !body?.text) return reply.code(400).send({ ok: false, error: "bad request" });
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    try {
      const mode = normalizeTtsMode(body.mode);
      const waited = await waitForHelperIdle();
      if (waited.waitedMs > 0 || !waited.idle) {
        log.info(
          `tts audio helper_wait device=${body.deviceId} message=${body.messageId ?? "none"} idle=${waited.idle} waited_ms=${waited.waitedMs} pending=${waited.pending} in_flight=${waited.inFlight}`,
        );
      }
      const audio = await createTtsAudio({ text: body.text, mode, voice: body.voice });
      log.info(
        `tts audio device=${body.deviceId} message=${body.messageId ?? "none"} mode=${mode} cache=${audio.cacheKey} generated=${audio.generated} script_chars=${audio.script.length}`,
      );
      return reply.send({
        ok: true,
        audioUrl: `/tts/audio/${audio.cacheKey}`,
        script: audio.script,
        mode,
        cacheKey: audio.cacheKey,
        generated: audio.generated,
      });
    } catch (e) {
      log.warn(`tts audio failed device=${body.deviceId} message=${body.messageId ?? "none"} error=${(e as { message?: string })?.message ?? String(e)}`);
      return reply.send({ ok: false, error: "tts_failed" });
    }
  });

  app.get("/tts/audio/:cacheKey", async (req, reply) => {
    const params = req.params as { cacheKey?: string };
    const filePath = params.cacheKey ? resolveTtsFile(params.cacheKey) : null;
    if (!filePath) return reply.code(400).send({ ok: false, error: "bad request" });
    try {
      await stat(filePath);
      return reply
        .header("Content-Type", "audio/mpeg")
        .header("Cache-Control", "public, max-age=604800")
        .send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
  });
}
