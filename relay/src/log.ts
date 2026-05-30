/**
 * Logger with bot-token / Authorization redaction (never log credentials).
 */
const TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
const AUTH_RE = /(Bearer\s+)[A-Za-z0-9._-]+/gi;

function redact(s: string): string {
  return s.replace(TOKEN_RE, "<bot-token>").replace(AUTH_RE, "$1<redacted>");
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
    .join(" ");
}

export const log = {
  info: (...a: unknown[]) => console.log(redact(fmt(a))),
  warn: (...a: unknown[]) => console.warn(redact(fmt(a))),
  error: (...a: unknown[]) => console.error(redact(fmt(a))),
};
