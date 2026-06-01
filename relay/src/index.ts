/**
 * Relay HTTP API. Endpoints (see plan Part A):
 *   POST /register   — device + bot tokens → starts/attaches poll loops
 *   POST /unregister — drop a bot or the whole device
 *   GET  /pull       — app's getUpdates replacement (buffered updates by cursor)
 *   GET  /health     — loop/offset snapshot
 */
import Fastify from "fastify";
import { config } from "./config.js";
import { store } from "./store.js";
import { newSecret, hashSecret, secretMatches } from "./crypto.js";
import { reconcileLoops, loopCount } from "./poller.js";
import { mtproto } from "./mtproto.js";
import { log } from "./log.js";
import type {
  RegisterBody,
  AuthStartBody,
  AuthCodeBody,
  Auth2faBody,
  PeerResolveBody,
  SendBody,
} from "./types.js";

// Raise the body limit so base64-encoded attachments (image/video/voice/docs) fit. ~60 MB
// of JSON ≈ a ~44 MB file.
const app = Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024 });

function authDevice(req: { headers: Record<string, unknown> }, deviceId: string): boolean {
  const dev = store.getDevice(deviceId);
  if (!dev) return false;
  const header = String(req.headers["authorization"] ?? "");
  const secret = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretMatches(secret, dev.device_secret_hash);
}

app.post("/register", async (req, reply) => {
  const body = req.body as RegisterBody;
  // expoPushToken may be empty (simulator / pull-only mode): the relay still polls and
  // buffers for /pull; push fan-out skips devices without a valid Expo token.
  if (!body?.deviceId || !body?.gateway || !Array.isArray(body?.bots)) {
    return reply.code(400).send({ ok: false, error: "bad request" });
  }

  const existing = store.getDevice(body.deviceId);
  let secret: string | undefined;
  let secretHash: string;
  if (existing) {
    // Re-register requires the existing secret (idempotent token refresh).
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
    // Bot-token path → create/refresh a poll loop. MTProto peers carry no token; the
    // relay's GramJS client receives for them, so we only record the subscription.
    if (b.botToken) store.upsertBot({ botId: b.botId, gateway: body.gateway, botToken: b.botToken });
    store.subscribe(body.deviceId, b.botId, b.buddyId);
    registered.push(b.buddyId);
  }

  reconcileLoops();
  log.info(`register device=${body.deviceId} bots=${registered.length}`);
  return reply.send({ ok: true, ...(secret ? { deviceSecret: secret } : {}), registered });
});

app.post("/unregister", async (req, reply) => {
  const body = req.body as { deviceId: string; botId?: number };
  if (!body?.deviceId) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });

  if (body.botId == null) store.removeDevice(body.deviceId);
  else store.unsubscribe(body.deviceId, body.botId);

  reconcileLoops(); // reaps now-orphaned bots + deletes their encrypted tokens
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

// ─── MTProto (user-account) auth + messaging ────────────────────────────────
function mtprotoErr(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const msg = (e as { errorMessage?: string; message?: string })?.errorMessage
    ?? (e as { message?: string })?.message
    ?? String(e);
  const flood = /FLOOD_WAIT_(\d+)/.exec(msg);
  if (flood) return reply.code(429).send({ ok: false, error: "flood_wait", retryAfter: Number(flood[1]) });
  if (msg.includes("PHONE_CODE_INVALID")) return reply.code(400).send({ ok: false, error: "invalid_code" });
  if (msg.includes("PHONE_CODE_EXPIRED")) return reply.code(400).send({ ok: false, error: "expired" });
  if (msg.includes("PASSWORD_HASH_INVALID")) return reply.code(400).send({ ok: false, error: "invalid_password" });
  log.warn(`mtproto error: ${msg}`);
  return reply.code(500).send({ ok: false, error: "mtproto", detail: msg });
}

app.post("/auth/start", async (req, reply) => {
  if (!config.mtprotoEnabled) return reply.code(503).send({ ok: false, error: "mtproto_disabled" });
  const body = req.body as AuthStartBody;
  if (!body?.deviceId || !body?.phone) return reply.code(400).send({ ok: false, error: "bad request" });

  // Login may precede /register, so mint the device + secret here if it's new.
  let secret: string | undefined;
  const existing = store.getDevice(body.deviceId);
  if (existing) {
    if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
  if (!body?.deviceId || !body?.code) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const r = await mtproto.confirmCode(body.deviceId, body.code);
    return reply.send({ ok: true, signedIn: r.signedIn, needs2fa: !r.signedIn, tgUserId: r.tgUserId });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

app.post("/auth/2fa", async (req, reply) => {
  const body = req.body as Auth2faBody;
  if (!body?.deviceId || !body?.password) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const tgUserId = await mtproto.confirm2fa(body.deviceId, body.password);
    return reply.send({ ok: true, signedIn: true, tgUserId });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

app.post("/auth/logout", async (req, reply) => {
  const body = req.body as { deviceId?: string };
  if (!body?.deviceId) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  await mtproto.logout(body.deviceId);
  return reply.send({ ok: true });
});

app.get("/auth/status", async (req, reply) => {
  const q = req.query as { deviceId?: string };
  const deviceId = q.deviceId ?? "";
  if (!deviceId) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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

app.post("/peers/resolve", async (req, reply) => {
  const body = req.body as PeerResolveBody;
  if (!body?.deviceId || !body?.username) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const peer = await mtproto.resolvePeer(body.deviceId, body.username);
    return reply.send({ ok: true, peer });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

app.post("/send", async (req, reply) => {
  const body = req.body as SendBody;
  if (!body?.deviceId || !body?.peerId || !body?.text) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const messageId = await mtproto.sendAs(body.deviceId, body.peerId, body.text, body.replyTo);
    return reply.send({ ok: true, messageId });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

// Send a file attachment (base64) as the user. kind: document|image|video|voice|audio.
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
    const messageId = await mtproto.sendMediaAs(body.deviceId, body.peerId, {
      buffer,
      fileName: body.fileName || "file",
      mime: body.mime || "application/octet-stream",
      kind: body.kind || "document",
      caption: body.caption,
    });
    return reply.send({ ok: true, messageId });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

// Proxy a message's webpage-preview photo (Telegram photos aren't public URLs). Unauthenticated
// by design — it only ever returns the same preview image Telegram already rendered for a link;
// the app builds this URL from the buffered preview.image path.
// Send several files as one album (base64). files: [{kind,fileName,mime,dataBase64}].
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
    const messageId = await mtproto.sendMediaGroupAs(body.deviceId, body.peerId, items, body.caption);
    return reply.send({ ok: true, messageId });
  } catch (e) {
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

app.get("/health", async () => {
  return { ok: true, loops: loopCount(), ...store.healthSnapshot() };
});

async function main() {
  if (config.isDevKey) {
    log.warn("RELAY_MASTER_KEY not set — using DEV key. DO NOT use real bot tokens in this mode.");
  }
  reconcileLoops(); // resume loops for bots already in the DB (restart recovery)
  setInterval(reconcileLoops, 60_000); // periodic prune + loop reconcile
  if (config.mtprotoEnabled) {
    await mtproto.reconnectAll(); // rebuild live user-account clients from saved sessions
    setInterval(() => void mtproto.reconnectAll(), 60_000);
    log.info("mtproto enabled (user-account path active)");
  } else {
    log.warn("TELEGRAM_API_ID/HASH not set — MTProto (user-account) path disabled.");
  }
  await app.listen({ port: config.port, host: config.host });
  log.info(`relay listening on ${config.host}:${config.port} — loops=${loopCount()}`);
}

void main();
