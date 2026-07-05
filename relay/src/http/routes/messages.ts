import type { FastifyInstance } from "fastify";
import { helperSubmitText } from "../../helper/submitFormatter.js";
import { log } from "../../log.js";
import { mtproto } from "../../mtproto.js";
import { messageStreams } from "../../streams.js";
import { store } from "../../store.js";
import type { FormSubmitBody, HelperSubmitBody, InlineKeyboardCallbackBody, MessageSyncBody, SendBody } from "../../types.js";
import { replyError, requireDeviceAuth } from "../guards.js";
import { mtprotoErr } from "../mtprotoError.js";

function sseData(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function registerMessageRoutes(app: FastifyInstance) {
  app.post("/messages/sync", async (req, reply) => {
    const body = req.body as MessageSyncBody;
    if (!body?.deviceId || !Number.isFinite(body.peerId)) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const since = Number.isFinite(body.sinceCursor)
        ? body.sinceCursor!
        : Number.isFinite(body.sinceUpdateId)
          ? body.sinceUpdateId!
          : 0;
      const limit = Number.isFinite(body.limit) ? body.limit! : 50;
      const updates = await mtproto.syncMessages(body.deviceId, body.peerId, {
        sinceUpdateId: Number.isFinite(body.sinceUpdateId) ? body.sinceUpdateId : 0,
        limit,
      });
      // Snapshot-cursor clients (sinceCursor) must NOT get the legacy reset-to-0
      // fallback: when the client is caught up (since > head), that fallback
      // replayed from cursor 0, so the client never stabilised at head and
      // re-crawled forever — new messages then showed up minutes late. Only the
      // legacy bot-token path (sinceUpdateId only) keeps the fallback.
      const usingSnapshotCursor = Number.isFinite(body.sinceCursor);
      const messages = store.listMessageSnapshots(body.peerId, since, limit, {
        legacyCursorFallback: !usingSnapshotCursor,
      });
      const cursor = messages.length ? messages[messages.length - 1]!.cursor + 1 : since;
      const legacyCursor = updates.length ? updates[updates.length - 1]!.update_id + 1 : (body.sinceUpdateId ?? 0);
      log.info(`messages sync device=${body.deviceId} peer=${body.peerId} since=${since} updates=${updates.length} messages=${messages.length}`);
      return reply.send({ ok: true, updates, messages, cursor, legacyCursor });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  // Self-heal: return the most recent snapshots regardless of the client's sync
  // cursor. The app calls this on chat entry to reconcile its display when the
  // cursor has drifted ahead of un-received messages (a live stream event or a
  // streaming-message cursor bump can leapfrog earlier messages).
  app.post("/messages/recent", async (req, reply) => {
    const body = req.body as { deviceId?: string; peerId?: number; limit?: number };
    if (!body?.deviceId || !Number.isFinite(body.peerId)) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const limit = Number.isFinite(body.limit) ? Math.min(body.limit!, 100) : 50;
      const messages = store.listRecentMessageSnapshots(body.peerId!, limit);
      const cursor = messages.length ? messages[messages.length - 1]!.cursor + 1 : 0;
      log.info(`messages recent device=${body.deviceId} peer=${body.peerId} returned=${messages.length}`);
      return reply.send({ ok: true, messages, cursor });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.get("/messages/stream", async (req, reply) => {
    const q = req.query as { deviceId?: string; peerId?: string; since?: string };
    const deviceId = q.deviceId ?? "";
    const peerId = Number(q.peerId);
    const since = Number(q.since ?? 0);
    if (!deviceId || !Number.isFinite(peerId)) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, deviceId, reply)) return;
    if (!store.getAccountPeer(deviceId, peerId)) return reply.code(404).send({ ok: false, error: "peer not found" });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    const initial = store.listMessageSnapshots(peerId, since, 100, { legacyCursorFallback: false });
    const cursor = initial.length ? initial[initial.length - 1]!.cursor + 1 : since;
    res.write(sseData({ type: "connected", peerId, cursor }));
    for (const message of initial) {
      res.write(sseData({ type: "message_updated", message }));
    }
    log.info(`stream open device=${deviceId} peer=${peerId} since=${since} replay=${initial.length} cursor=${cursor}`);
    const unsubscribe = messageStreams.subscribe(peerId, (event) => {
      res.write(sseData(event));
    });
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 25000);
    req.raw.on("close", () => {
      log.info(`stream close device=${deviceId} peer=${peerId}`);
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post("/send", async (req, reply) => {
    const body = req.body as SendBody;
    if (!body?.deviceId || !body?.peerId || !body?.text) return replyError(reply, 400, "bad request");
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    const clientTag = typeof body.clientTag === "string" && body.clientTag ? body.clientTag : undefined;
    try {
      const messageId = await mtproto.sendAs(body.deviceId, body.peerId, body.text, body.replyTo, clientTag);
      // Belt-and-braces: if the echo was snapshotted before the pending tag was
      // matched (or matching missed), stamp the tag now so a republish carries it.
      if (clientTag) {
        try {
          const existing = store.getMessageSnapshot(body.peerId, messageId);
          if (existing && !existing.clientTag) {
            const result = store.upsertMessageSnapshot({ ...existing, clientTag });
            if (result.changed) {
              messageStreams.publish(body.peerId, { type: "message_updated", message: result.message });
            }
          }
        } catch {
          // best-effort only — the app's text fallback covers a missed stamp
        }
      }
      return reply.send({ ok: true, messageId });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.post("/form/submit", async (req, reply) => {
    const body = req.body as FormSubmitBody;
    if (!body?.deviceId || !body?.peerId || !body?.formId || !body?.status || !body?.values) {
      return replyError(reply, 400, "bad request");
    }
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    const text = [
      "```agent_form_response",
      JSON.stringify(
        { formId: body.formId, taskId: body.taskId, status: body.status, values: body.values },
        null,
        2,
      ),
      "```",
    ].join("\n");
    try {
      const messageId = await mtproto.sendAs(body.deviceId, body.peerId, text);
      return reply.send({ ok: true, messageId });
    } catch (e) {
      return mtprotoErr(reply, e);
    }
  });

  app.post("/helper/submit", async (req, reply) => {
    const body = req.body as HelperSubmitBody;
    if (!body?.deviceId || !body?.peerId || !body?.helperItemId || !body?.helperType || !body?.action) {
      return replyError(reply, 400, "bad request");
    }
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    const source = body.source ?? {};
    log.info(
      `helper.submit.received device=${body.deviceId} peer=${body.peerId} helper=${body.helperItemId} type=${body.helperType} action=${body.action} source_msg=${source.messageId ?? "none"} source_text_len=${source.text?.length ?? 0} source_urls=${source.urls?.length ?? 0} recent=${source.recentMessages?.length ?? 0}`,
    );
    const text = helperSubmitText(body);
    try {
      const messageId = await mtproto.sendAs(body.deviceId, body.peerId, text);
      log.info(
        `helper.submit.sent device=${body.deviceId} peer=${body.peerId} tg_message_id=${messageId} helper=${body.helperItemId} action=${body.action} source_msg=${source.messageId ?? "none"}`,
      );
      return reply.send({ ok: true, messageId });
    } catch (e) {
      log.warn(
        `helper.submit.failed device=${body.deviceId} peer=${body.peerId} helper=${body.helperItemId} action=${body.action} source_msg=${source.messageId ?? "none"} error=${(e as { message?: string })?.message ?? String(e)}`,
      );
      return mtprotoErr(reply, e);
    }
  });

  app.post("/inline-keyboard/callback", async (req, reply) => {
    const body = req.body as InlineKeyboardCallbackBody;
    if (!body?.deviceId || !body?.peerId || !body?.messageId || !body?.buttonId) {
      return replyError(reply, 400, "bad request");
    }
    if (!requireDeviceAuth(req, body.deviceId, reply)) return;
    try {
      const result = await mtproto.clickInlineButton(body.deviceId, body.peerId, body.messageId, body.buttonId);
      log.info(`inline keyboard callback device=${body.deviceId} peer=${body.peerId} msg=${body.messageId} button=${body.buttonId}`);
      return reply.send({ ok: true, result });
    } catch (e) {
      log.warn(
        `inline keyboard callback failed device=${body.deviceId} peer=${body.peerId} msg=${body.messageId} button=${body.buttonId} error=${(e as { message?: string })?.message ?? String(e)}`,
      );
      return mtprotoErr(reply, e);
    }
  });
}
