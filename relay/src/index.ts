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
import { log } from "./log.js";
import type { RegisterBody } from "./types.js";

const app = Fastify({ logger: false });

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
    if (!b?.botToken || !b?.botId || !b?.buddyId) continue;
    store.upsertBot({ botId: b.botId, gateway: body.gateway, botToken: b.botToken });
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

app.get("/health", async () => {
  return { ok: true, loops: loopCount(), ...store.healthSnapshot() };
});

async function main() {
  if (config.isDevKey) {
    log.warn("RELAY_MASTER_KEY not set — using DEV key. DO NOT use real bot tokens in this mode.");
  }
  reconcileLoops(); // resume loops for bots already in the DB (restart recovery)
  setInterval(reconcileLoops, 60_000); // periodic prune + loop reconcile
  await app.listen({ port: config.port, host: config.host });
  log.info(`relay listening on ${config.host}:${config.port} — loops=${loopCount()}`);
}

void main();
