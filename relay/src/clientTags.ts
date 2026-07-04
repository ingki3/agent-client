/**
 * Pending clientTag registry for /send.
 *
 * The app sends a clientTag (its optimistic message id) with POST /send. The
 * GramJS NewMessage echo for that send can arrive BEFORE sendMessage resolves
 * with the Telegram message id, so a messageId→tag mapping registered after
 * the fact would be too late for the first snapshot publish. Instead the tag
 * is registered before the MTProto send and the outgoing echo is matched back
 * to it by device + peer + compacted text.
 *
 * In-memory only: a relay restart mid-send just degrades to the app's
 * text-matching fallback.
 */

type PendingTag = {
  deviceId: string;
  peerId: number;
  text: string;
  clientTag: string;
  at: number;
};

const TTL_MS = 30_000;

let pendingTags: PendingTag[] = [];

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sweep(now: number): void {
  pendingTags = pendingTags.filter((tag) => now - tag.at <= TTL_MS);
}

export const clientTags = {
  register(deviceId: string, peerId: number, text: string, clientTag: string): void {
    const now = Date.now();
    sweep(now);
    pendingTags.push({ deviceId, peerId, text: compactText(text), clientTag, at: now });
  },

  /**
   * Match an outgoing echo to a pending tag (FIFO, consumed on match). Exact
   * compacted-text match first; if none, fall back to the single oldest pending
   * entry for that device+peer (covers Telegram-side text normalization).
   */
  matchOutgoing(deviceId: string, peerId: number, text: string): string | undefined {
    const now = Date.now();
    sweep(now);
    const compacted = compactText(text);
    const scoped = pendingTags.filter((tag) => tag.deviceId === deviceId && tag.peerId === peerId);
    let match = scoped.find((tag) => tag.text === compacted);
    if (!match && scoped.length === 1) match = scoped[0];
    if (!match) return undefined;
    pendingTags = pendingTags.filter((tag) => tag !== match);
    return match.clientTag;
  },

  /** Drop a registered tag (the send failed — its echo will never arrive). */
  discard(clientTag: string): void {
    sweep(Date.now());
    pendingTags = pendingTags.filter((tag) => tag.clientTag !== clientTag);
  },

  /** Test helper. */
  _reset(): void {
    pendingTags = [];
  },
};
