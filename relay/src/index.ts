import { config } from "./config.js";
import { createRelayApp } from "./http/app.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerFcmDebugRoutes } from "./http/routes/fcmDebug.js";
import { registerLinkPreviewRoutes } from "./http/routes/linkPreview.js";
import { registerMediaRoutes } from "./http/routes/media.js";
import { registerMessageRoutes } from "./http/routes/messages.js";
import { registerPeerRoutes } from "./http/routes/peers.js";
import { registerSystemRoutes } from "./http/routes/system.js";
import { registerTtsRoutes } from "./http/routes/tts.js";
import { log } from "./log.js";
import { mtproto } from "./mtproto.js";
import { loopCount, reconcileLoops } from "./poller.js";

// Crash safety net: a transient MTProto/network rejection must never take the
// whole relay down. Log and keep running instead of letting Node exit.
process.on("unhandledRejection", (reason) => {
  log.error(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});
process.on("uncaughtException", (err) => {
  log.error(`uncaughtException: ${err.stack ?? err.message}`);
});

/** Run a periodic task without ever letting it throw out of the timer. */
function safeInterval(fn: () => void | Promise<void>, ms: number, label: string): void {
  setInterval(() => {
    void (async () => {
      try {
        await fn();
      } catch (e) {
        log.error(`interval ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, ms);
}

const app = createRelayApp();

registerSystemRoutes(app);
registerLinkPreviewRoutes(app);
registerTtsRoutes(app);
registerAuthRoutes(app);
registerPeerRoutes(app);
registerMessageRoutes(app);
registerMediaRoutes(app);
registerFcmDebugRoutes(app);

async function main() {
  if (config.isDevKey) {
    log.warn("RELAY_MASTER_KEY not set — using DEV key. DO NOT use real bot tokens in this mode.");
  }
  reconcileLoops();
  safeInterval(reconcileLoops, 60_000, "reconcileLoops");
  if (config.mtprotoEnabled) {
    try {
      await mtproto.reconnectAll();
    } catch (e) {
      log.error(`initial mtproto.reconnectAll failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
    }
    safeInterval(() => mtproto.reconnectAll(), 60_000, "mtproto.reconnectAll");
    log.info("mtproto enabled (user-account path active)");
  } else {
    log.warn("TELEGRAM_API_ID/HASH not set — MTProto (user-account) path disabled.");
  }
  await app.listen({ port: config.port, host: config.host });
  log.info(`relay listening on ${config.host}:${config.port} — loops=${loopCount()}`);
}

void main();
