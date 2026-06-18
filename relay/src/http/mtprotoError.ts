import { log } from "../log.js";

export function mtprotoErr(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  e: unknown,
) {
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
