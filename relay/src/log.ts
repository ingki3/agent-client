/**
 * Logger with bot-token / Authorization redaction (never log credentials).
 *
 * Logs go to the console AND are appended to a persistent file (default
 * .cache/relay.log, override with RELAY_LOG_FILE) so that a crash trail
 * survives the process. Set RELAY_LOG_FILE="" to disable file logging.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
const AUTH_RE = /(Bearer\s+)[A-Za-z0-9._-]+/gi;

const LOG_FILE = process.env.RELAY_LOG_FILE ?? ".cache/relay.log";

let fileSink: ((line: string) => void) | null = null;
if (LOG_FILE) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    fileSink = (line) => {
      try {
        appendFileSync(LOG_FILE, line + "\n");
      } catch {
        // Never let logging failure crash the relay.
      }
    };
  } catch {
    fileSink = null;
  }
}

function redact(s: string): string {
  return s.replace(TOKEN_RE, "<bot-token>").replace(AUTH_RE, "$1<redacted>");
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
    .join(" ");
}

function emit(level: "INFO" | "WARN" | "ERROR", args: unknown[]): string {
  const line = redact(fmt(args));
  if (fileSink) {
    const ts = new Date().toISOString();
    fileSink(`[${ts}] [${level}] ${line}`);
  }
  return line;
}

export const log = {
  info: (...a: unknown[]) => console.log(emit("INFO", a)),
  warn: (...a: unknown[]) => console.warn(emit("WARN", a)),
  error: (...a: unknown[]) => console.error(emit("ERROR", a)),
};
