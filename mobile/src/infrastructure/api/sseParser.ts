/**
 * Incremental SSE frame parser for the relay `/messages/stream` endpoint.
 *
 * The relay writes one `data: {json}\n\n` frame per event plus `: heartbeat\n\n`
 * comment frames every 25s. Network chunks can split a frame anywhere, so the
 * caller accumulates raw text and drains it here: only complete frames (up to
 * the last `\n\n` boundary) are consumed — the incomplete tail is returned as
 * `rest` and must be carried into the next drain.
 */
export interface SseDrainResult {
  /** Raw payloads of complete `data:` frames, in arrival order. */
  events: string[];
  /** Unconsumed tail (an incomplete frame) — prepend to the next chunk. */
  rest: string;
}

export function drainSseBuffer(buffer: string): SseDrainResult {
  const boundary = buffer.lastIndexOf('\n\n');
  if (boundary === -1) return { events: [], rest: buffer };

  const complete = buffer.slice(0, boundary);
  const rest = buffer.slice(boundary + 2);
  const events: string[] = [];

  for (const block of complete.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    // Per SSE spec multiple `data:` lines concatenate with '\n'. The relay
    // emits a single line today; handling the general case costs nothing.
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)));
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n').trim();
    if (payload) events.push(payload);
  }

  return { events, rest };
}
