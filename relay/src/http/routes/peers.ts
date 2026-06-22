import type { FastifyInstance } from "fastify";
import { log } from "../../log.js";
import { mtproto } from "../../mtproto.js";
import { store } from "../../store.js";
import type { PeerRemoveBody, PeerResolveBody } from "../../types.js";
import { replyError, requireDeviceAuth } from "../guards.js";
import { mtprotoErr } from "../mtprotoError.js";

export function registerPeerRoutes(app: FastifyInstance) {
  app.get("/peers/list", async (req, reply) => {
    const q = req.query as { deviceId?: string };
    const deviceId = q.deviceId ?? "";
    if (!deviceId) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, deviceId, reply)) return;
    const peers = store.listAccountPeers(deviceId).map((p) => ({
      peerId: p.peer_id,
      username: p.username ?? "",
      title: p.title ?? p.username ?? String(p.peer_id),
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at,
    }));
    log.info(`peers list device=${deviceId} count=${peers.length}`);
    return reply.send({ ok: true, peers });
  });

  app.post("/peers/resolve", async (req, reply) => {
    const body = req.body as PeerResolveBody;
    if (!body?.deviceId || !body?.username) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const peer = await mtproto.resolvePeer(body.deviceId, body.username);
      return reply.send({ ok: true, peer });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.post("/peers/remove", async (req, reply) => {
    const body = req.body as PeerRemoveBody;
    if (!body?.deviceId || !Number.isFinite(body.peerId)) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    store.removeAccountPeer(body.deviceId, body.peerId);
    log.info(`peers remove device=${body.deviceId} peer=${body.peerId}`);
    return reply.send({ ok: true });
  });
}
