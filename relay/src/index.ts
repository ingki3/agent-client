/**
 * Relay HTTP API. Endpoints (see plan Part A):
 *   POST /register   — device + bot tokens → starts/attaches poll loops
 *   POST /unregister — drop a bot or the whole device
 *   GET  /pull       — app's getUpdates replacement (buffered updates by cursor)
 *   GET  /health     — loop/offset snapshot
 */
import Fastify from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { config } from "./config.js";
import { store } from "./store.js";
import { newSecret, hashSecret, secretMatches } from "./crypto.js";
import { reconcileLoops, loopCount } from "./poller.js";
import { mtproto } from "./mtproto.js";
import { log } from "./log.js";
import { createTtsAudio, createTtsScript, resolveTtsFile } from "./tts.js";
import { messageStreams } from "./streams.js";
import type {
  RegisterBody,
  AuthStartBody,
  AuthCodeBody,
  Auth2faBody,
  PeerRemoveBody,
  PeerResolveBody,
  MessageSyncBody,
  SendBody,
  FormSubmitBody,
  HelperSubmitBody,
  TtsBody,
  TtsMode,
  InlineKeyboardCallbackBody,
} from "./types.js";

// Raise the body limit so base64-encoded attachments (image/video/voice/docs) fit. ~60 MB
// of JSON ≈ a ~44 MB file.
const app = Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024 });

function firstMatch(input: string, re: RegExp): string | undefined {
  const m = input.match(re);
  return m?.[1]?.trim();
}

function decodeHtml(input?: string): string | undefined {
  if (!input) return undefined;
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(maybeUrl: string | undefined, base: string): string | undefined {
  if (!maybeUrl) return undefined;
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchLinkPreview(url: string): Promise<{ url: string; title?: string; description?: string; siteName?: string; image?: string }> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("unsupported_url");

  if (/(^|\.)youtu\.be$|(^|\.)youtube\.com$/.test(target.hostname)) {
    const oembed = new URL("https://www.youtube.com/oembed");
    oembed.searchParams.set("url", target.toString());
    oembed.searchParams.set("format", "json");
    const res = await fetch(oembed, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const body = (await res.json()) as { title?: string; provider_name?: string; thumbnail_url?: string };
      return {
        url: target.toString(),
        title: body.title,
        siteName: body.provider_name ?? "YouTube",
        image: body.thumbnail_url,
      };
    }
  }

  const res = await fetch(target, {
    headers: { "User-Agent": "AgentClientLinkPreview/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  const html = (await res.text()).slice(0, 400000);
  const attr = (name: string) =>
    firstMatch(html, new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"))
    ?? firstMatch(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, "i"));
  const title = decodeHtml(attr("og:title") ?? attr("twitter:title") ?? firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = decodeHtml(attr("og:description") ?? attr("description") ?? attr("twitter:description"));
  const siteName = decodeHtml(attr("og:site_name") ?? target.hostname.replace(/^www\./, ""));
  const image = absoluteUrl(decodeHtml(attr("og:image") ?? attr("twitter:image")), target.toString());
  return { url: target.toString(), title, description, siteName, image };
}

function normalizeTtsMode(mode: unknown): TtsMode {
  return mode === "brief" || mode === "action_items" || mode === "explain" ? mode : "brief";
}

function authDevice(req: { headers: Record<string, unknown> }, deviceId: string): boolean {
  const dev = store.getDevice(deviceId);
  if (!dev) return false;
  const header = String(req.headers["authorization"] ?? "");
  const secret = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretMatches(secret, dev.device_secret_hash);
}

function sseData(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function trimText(value: unknown, max: number): unknown {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function compactHelperSource(source: NonNullable<HelperSubmitBody["source"]>, mode: "normal" | "small" = "normal") {
  const textMax = mode === "small" ? 450 : 900;
  const recentTextMax = mode === "small" ? 120 : 260;
  return {
    messageId: source.messageId,
    text: trimText(source.text, textMax),
    excerpt: trimText(source.excerpt, 240),
    urls: source.urls?.slice(0, 3),
    handles: source.handles?.slice(0, 4),
    preview: source.preview
      ? {
          url: source.preview.url,
          title: trimText(source.preview.title, 160),
          description: trimText(source.preview.description, mode === "small" ? 120 : 240),
          siteName: source.preview.siteName,
        }
      : undefined,
    attachments: source.attachments?.slice(0, 3),
    recentMessages: source.recentMessages?.slice(mode === "small" ? -3 : -5).map((m) => ({
      messageId: m.messageId,
      role: m.role,
      text: trimText(m.text, recentTextMax),
      excerpt: trimText(m.excerpt, 160),
      urls: m.urls?.slice(0, 2),
      preview: m.preview ? { url: m.preview.url, title: trimText(m.preview.title, 120), siteName: m.preview.siteName } : undefined,
    })),
  };
}

function helperSubmitText(body: HelperSubmitBody): string {
  const make = (source: unknown) => [
    "사용자가 아래 후속 액션을 선택했습니다.",
    "이 액션은 source 메시지의 대상/문맥에만 적용하세요.",
    "source.recentMessages가 있으면 전체 대화 맥락 복원에 참고하세요.",
    "",
    "```agent_helper_response",
    JSON.stringify(
      {
        helperItemId: body.helperItemId,
        helperType: body.helperType,
        action: body.action,
        label: body.label,
        value: body.value,
        values: body.values ?? {},
        source,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  const normal = make(compactHelperSource(body.source ?? {}, "normal"));
  if (normal.length <= 3800) return normal;
  const small = make(compactHelperSource(body.source ?? {}, "small"));
  if (small.length <= 3800) return small;
  return make({ messageId: body.source?.messageId, urls: body.source?.urls?.slice(0, 2), excerpt: trimText(body.source?.excerpt ?? body.source?.text, 180) }).slice(0, 3800);
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

app.post("/tts/script", async (req, reply) => {
  const body = req.body as TtsBody;
  if (!body?.deviceId || !body?.text) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const mode = normalizeTtsMode(body.mode);
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

app.get("/peers/list", async (req, reply) => {
  const q = req.query as { deviceId?: string };
  const deviceId = q.deviceId ?? "";
  if (!deviceId) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
  if (!body?.deviceId || !body?.username) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  try {
    const peer = await mtproto.resolvePeer(body.deviceId, body.username);
    return reply.send({ ok: true, peer });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

app.post("/peers/remove", async (req, reply) => {
  const body = req.body as PeerRemoveBody;
  if (!body?.deviceId || !Number.isFinite(body.peerId)) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  store.removeAccountPeer(body.deviceId, body.peerId);
  log.info(`peers remove device=${body.deviceId} peer=${body.peerId}`);
  return reply.send({ ok: true });
});

app.post("/messages/sync", async (req, reply) => {
  const body = req.body as MessageSyncBody;
  if (!body?.deviceId || !Number.isFinite(body.peerId)) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
    const messages = store.listMessageSnapshots(body.peerId, since, limit);
    const cursor = messages.length ? messages[messages.length - 1]!.cursor + 1 : since;
    const legacyCursor = updates.length ? updates[updates.length - 1]!.update_id + 1 : (body.sinceUpdateId ?? 0);
    log.info(`messages sync device=${body.deviceId} peer=${body.peerId} since=${since} updates=${updates.length} messages=${messages.length}`);
    return reply.send({ ok: true, updates, messages, cursor, legacyCursor });
  } catch (e) {
    return mtprotoErr(reply, e);
  }
});

app.get("/messages/stream", async (req, reply) => {
  const q = req.query as { deviceId?: string; peerId?: string; since?: string };
  const deviceId = q.deviceId ?? "";
  const peerId = Number(q.peerId);
  const since = Number(q.since ?? 0);
  if (!deviceId || !Number.isFinite(peerId)) return reply.code(400).send({ ok: false, error: "bad request" });
  if (!authDevice(req, deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
  const unsubscribe = messageStreams.subscribe(peerId, (event) => {
    res.write(sseData(event));
  });
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);
  req.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
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

app.post("/form/submit", async (req, reply) => {
  const body = req.body as FormSubmitBody;
  if (!body?.deviceId || !body?.peerId || !body?.formId || !body?.status || !body?.values) {
    return reply.code(400).send({ ok: false, error: "bad request" });
  }
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
    return reply.code(400).send({ ok: false, error: "bad request" });
  }
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  const source = body.source ?? {};
  log.info(
    `helper submit received device=${body.deviceId} peer=${body.peerId} helper=${body.helperItemId} type=${body.helperType} action=${body.action} source_msg=${source.messageId ?? "none"} source_text_len=${source.text?.length ?? 0} source_urls=${source.urls?.length ?? 0} recent=${source.recentMessages?.length ?? 0}`,
  );
  const text = helperSubmitText(body);
  try {
    const messageId = await mtproto.sendAs(body.deviceId, body.peerId, text);
    log.info(
      `helper submit sent device=${body.deviceId} peer=${body.peerId} tg_message_id=${messageId} helper=${body.helperItemId} action=${body.action} source_msg=${source.messageId ?? "none"}`,
    );
    return reply.send({ ok: true, messageId });
  } catch (e) {
    log.warn(
      `helper submit failed device=${body.deviceId} peer=${body.peerId} helper=${body.helperItemId} action=${body.action} source_msg=${source.messageId ?? "none"} error=${(e as { message?: string })?.message ?? String(e)}`,
    );
    return mtprotoErr(reply, e);
  }
});

app.post("/inline-keyboard/callback", async (req, reply) => {
  const body = req.body as InlineKeyboardCallbackBody;
  if (!body?.deviceId || !body?.peerId || !body?.messageId || !body?.buttonId) {
    return reply.code(400).send({ ok: false, error: "bad request" });
  }
  if (!authDevice(req, body.deviceId)) return reply.code(401).send({ ok: false, error: "unauthorized" });
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
