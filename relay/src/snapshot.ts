import { store } from "./store.js";
import { messageStreams } from "./streams.js";
import type { NormalizedMessage, TgUpdate } from "./types.js";
import { looksCompleteForHelper } from "./messageText.js";

export function snapshotStatus(text: string): NormalizedMessage["status"] {
  const trimmed = text.trim();
  if (!trimmed || /^[.…·\-\s]+$/.test(trimmed)) return "streaming";
  if (/^(?:진행 상황|🛠|💻|📚\s*skill_view:|Transcript:)/i.test(trimmed)) return "streaming";
  if (looksCompleteForHelper(trimmed)) return "complete";
  // Short conversational replies often do not pass helper eligibility, but they are still
  // complete message snapshots for DB sync.
  if (trimmed.length < 240) return "complete";
  return "streaming";
}

export function snapshotFromUpdate(update: TgUpdate): Omit<NormalizedMessage, "cursor" | "updatedAt"> | null {
  const message = update.message ?? update.edited_message;
  if (!message) return null;
  const text = message.text ?? "";
  return {
    id: String(message.message_id),
    peerId: message.chat.id,
    messageId: message.message_id,
    role: message.outgoing ? "user" : "agent",
    text,
    status: snapshotStatus(text),
    date: message.date,
    ...(message.preview ? { preview: message.preview } : {}),
    ...(message.media ? { media: message.media } : {}),
    ...(message.helper_items ? { helperItems: message.helper_items } : {}),
    ...(message.inline_keyboard !== undefined ? { inlineKeyboard: message.inline_keyboard } : {}),
    ...(message.client_tag ? { clientTag: message.client_tag } : {}),
  };
}

export function upsertAndPublishSnapshot(
  update: TgUpdate,
  eventType: "message_updated" | "helper_updated" = "message_updated",
  opts: { publish?: boolean; updateComplete?: boolean } = {},
): NormalizedMessage | null {
  const shouldPublish = opts.publish !== false;
  const message = update.message ?? update.edited_message;
  if (message?.helper_items && message.text === undefined) {
    const merged = store.mergeSnapshotHelperItems(message.chat.id, message.message_id, message.helper_items);
    if (shouldPublish && merged?.changed) {
      messageStreams.publish(message.chat.id, { type: "helper_updated", message: merged.message });
    }
    return merged?.message ?? null;
  }
  const snapshot = snapshotFromUpdate(update);
  if (!snapshot) return null;
  const existing = store.getMessageSnapshot(snapshot.peerId, snapshot.messageId);
  if (opts.updateComplete === false && existing) {
    if (existing.status === "complete" || !existing.text.trim()) return existing;
  }
  const result = store.upsertMessageSnapshot(snapshot);
  if (shouldPublish && result.changed) {
    messageStreams.publish(snapshot.peerId, { type: eventType, message: result.message });
  }
  return result.message;
}
