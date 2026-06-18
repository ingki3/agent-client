import { config } from "./config.js";
import { createRelayApp } from "./http/app.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerLinkPreviewRoutes } from "./http/routes/linkPreview.js";
import { registerMediaRoutes } from "./http/routes/media.js";
import { registerMessageRoutes } from "./http/routes/messages.js";
import { registerPeerRoutes } from "./http/routes/peers.js";
import { registerSystemRoutes } from "./http/routes/system.js";
import { registerTtsRoutes } from "./http/routes/tts.js";
import { log } from "./log.js";
import { mtproto } from "./mtproto.js";
import { loopCount, reconcileLoops } from "./poller.js";

const app = createRelayApp();

registerSystemRoutes(app);
registerLinkPreviewRoutes(app);
registerTtsRoutes(app);
registerAuthRoutes(app);
registerPeerRoutes(app);
registerMessageRoutes(app);
registerMediaRoutes(app);

async function main() {
  if (config.isDevKey) {
    log.warn("RELAY_MASTER_KEY not set — using DEV key. DO NOT use real bot tokens in this mode.");
  }
  reconcileLoops();
  setInterval(reconcileLoops, 60_000);
  if (config.mtprotoEnabled) {
    await mtproto.reconnectAll();
    setInterval(() => void mtproto.reconnectAll(), 60_000);
    log.info("mtproto enabled (user-account path active)");
  } else {
    log.warn("TELEGRAM_API_ID/HASH not set — MTProto (user-account) path disabled.");
  }
  await app.listen({ port: config.port, host: config.host });
  log.info(`relay listening on ${config.host}:${config.port} — loops=${loopCount()}`);
}

void main();
