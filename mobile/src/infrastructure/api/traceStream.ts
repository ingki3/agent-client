/**
 * Trace + delta stream (PRD §5.3 extension, TECH_SPEC §3.2 / §12.2).
 *
 * Two implementations behind one event shape:
 *  - `openSseStream`  — real Server-Sent-Events stream from an Agent Gateway. Uses
 *    XMLHttpRequest incremental `responseText` (works on RN Hermes + web, no polyfill).
 *  - `simulateStream` — client-side typewriter that re-emits a finished reply chunk by
 *    chunk (so the streaming render path is exercised even against a plain Telegram bot,
 *    which returns whole messages), optionally with a synthetic trace.
 *
 * Both return a handle with `.close()` for the Stop button / screen-leave (TECH_SPEC §3.2).
 */
import { config } from "../config";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; step: number; summary: string; content?: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; startedAt: number }
  | { type: "tool_result"; id: string; status: "ok" | "error"; preview: string; latencyMs: number }
  | { type: "done" }
  | { type: "error"; message: string };

export type StreamHandle = { close: () => void };

/** Real SSE consumer for `{apiBase}/v1/messages/{messageId}/stream`. */
export function openSseStream(
  messageId: string,
  authToken: string,
  onEvent: (e: StreamEvent) => void,
): StreamHandle {
  const xhr = new XMLHttpRequest();
  let lastIndex = 0;
  let closed = false;

  xhr.open("GET", `${config.apiBase}/v1/messages/${messageId}/stream`);
  xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
  xhr.setRequestHeader("Accept", "text/event-stream");

  const flush = () => {
    const text = xhr.responseText.slice(lastIndex);
    lastIndex = xhr.responseText.length;
    for (const block of text.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as StreamEvent);
      } catch {
        onEvent({ type: "delta", text: raw }); // tolerate plain-text data lines
      }
    }
  };

  xhr.onprogress = flush;
  xhr.onload = () => {
    if (closed) return;
    flush();
    onEvent({ type: "done" });
  };
  xhr.onerror = () => {
    if (!closed) onEvent({ type: "error", message: "stream error" });
  };
  xhr.send();

  return {
    close: () => {
      closed = true;
      xhr.abort();
    },
  };
}

type SimulateOpts = {
  /** Words per emitted chunk. */
  chunkSize?: number;
  /** ms between chunks. */
  intervalMs?: number;
  /** Optional synthetic trace emitted before the text (mock buddies only). */
  trace?: Array<Extract<StreamEvent, { type: "thinking" | "tool_call" | "tool_result" }>>;
};

/**
 * Re-emit `fullText` as a typewriter delta stream. Used when the source returns a
 * whole message (plain Telegram bot or canned mock reply) but we still want the
 * progressive render UX (FR-14).
 */
export function simulateStream(
  fullText: string,
  onEvent: (e: StreamEvent) => void,
  opts: SimulateOpts = {},
): StreamHandle {
  const { chunkSize = 2, intervalMs = 45, trace } = opts;
  const words = fullText.split(/(\s+)/); // keep whitespace tokens
  let i = 0;
  let traceIdx = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const step = () => {
    if (cancelled) return;
    // Emit synthetic trace nodes first, one per tick, then the text.
    if (trace && traceIdx < trace.length) {
      onEvent(trace[traceIdx]!);
      traceIdx += 1;
      timer = setTimeout(step, intervalMs * 3);
      return;
    }
    if (i >= words.length) {
      onEvent({ type: "done" });
      return;
    }
    const chunk = words.slice(i, i + chunkSize * 2).join("");
    i += chunkSize * 2;
    onEvent({ type: "delta", text: chunk });
    timer = setTimeout(step, intervalMs);
  };

  timer = setTimeout(step, intervalMs);

  return {
    close: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
