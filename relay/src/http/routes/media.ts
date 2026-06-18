import type { FastifyInstance } from "fastify";
import { log } from "../../log.js";
import { mtproto } from "../../mtproto.js";
import { authDevice } from "../authDevice.js";
import { mtprotoErr } from "../mtprotoError.js";

function describeMedia(kind?: string, fileName?: string, mime?: string, byteLength?: number): string {
  return `kind=${kind || "document"} file=${JSON.stringify(fileName || "file")} mime=${mime || "application/octet-stream"} bytes=${byteLength ?? 0}`;
}

export function registerMediaRoutes(app: FastifyInstance) {
  app.post("/sendMedia", async (req, reply) => {
    const body = req.body as {
      deviceId?: string;
      peerId?: number;
      kind?: string;
      fileName?: string;
      mime?: string;
      caption?: string;
      dataBase64?: string;
    };
    if (!body?.deviceId || !body?.peerId || !body?.dataBase64) {
      return reply.code(400).send({ ok: false, error: "bad request" });
    }
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    try {
      const buffer = Buffer.from(body.dataBase64, "base64");
      log.info(`/sendMedia start device=${body.deviceId} peer=${body.peerId} ${describeMedia(body.kind, body.fileName, body.mime, buffer.length)} caption=${body.caption ? "yes" : "no"}`);
      const messageId = await mtproto.sendMediaAs(body.deviceId, body.peerId, {
        buffer,
        fileName: body.fileName || "file",
        mime: body.mime || "application/octet-stream",
        kind: body.kind || "document",
        caption: body.caption,
      });
      log.info(`/sendMedia ok device=${body.deviceId} peer=${body.peerId} msg=${messageId}`);
      return reply.send({ ok: true, messageId });
    } catch (e) {
      log.warn(`/sendMedia failed device=${body.deviceId} peer=${body.peerId} error=${String(e)}`);
      return mtprotoErr(reply, e);
    }
  });

  app.post("/sendMediaGroup", async (req, reply) => {
    const body = req.body as {
      deviceId?: string;
      peerId?: number;
      caption?: string;
      files?: { kind?: string; fileName?: string; mime?: string; dataBase64?: string }[];
    };
    if (!body?.deviceId || !body?.peerId || !Array.isArray(body.files) || body.files.length === 0) {
      return reply.code(400).send({ ok: false, error: "bad request" });
    }
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
    try {
      const items = body.files
        .filter((f) => f.dataBase64)
        .map((f) => ({
          buffer: Buffer.from(f.dataBase64 as string, "base64"),
          fileName: f.fileName || "file",
          mime: f.mime || "application/octet-stream",
          kind: f.kind || "document",
        }));
      if (items.length === 0) {
        return reply.code(400).send({ ok: false, error: "bad request" });
      }
      log.info(`/sendMediaGroup start device=${body.deviceId} peer=${body.peerId} count=${items.length} caption=${body.caption ? "yes" : "no"} ${items.map((item) => describeMedia(item.kind, item.fileName, item.mime, item.buffer.length)).join("; ")}`);
      const messageId = await mtproto.sendMediaGroupAs(body.deviceId, body.peerId, items, body.caption);
      log.info(`/sendMediaGroup ok device=${body.deviceId} peer=${body.peerId} msg=${messageId}`);
      return reply.send({ ok: true, messageId });
    } catch (e) {
      log.warn(`/sendMediaGroup failed device=${body.deviceId} peer=${body.peerId} error=${String(e)}`);
      return mtprotoErr(reply, e);
    }
  });

  app.get("/media", async (req, reply) => {
    const q = req.query as { deviceId?: string; peer?: string; msg?: string };
    const deviceId = q.deviceId ?? "";
    const peer = Number(q.peer);
    const msg = Number(q.msg);
    if (!deviceId || !Number.isFinite(peer) || !Number.isFinite(msg)) {
      return reply.code(400).send({ ok: false, error: "bad request" });
    }
    try {
      const res = await mtproto.downloadMessageMedia(deviceId, peer, msg);
      if (!res) return reply.code(404).send({ ok: false, error: "no media" });
      return reply
        .header("Content-Type", res.mime || "application/octet-stream")
        .header("Cache-Control", "public, max-age=86400")
        .send(res.buffer);
    } catch (e) {
      log.warn(`/media failed: ${String(e)}`);
      return reply.code(500).send({ ok: false, error: "media" });
    }
  });
}
