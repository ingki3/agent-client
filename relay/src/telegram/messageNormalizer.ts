import type { AgentPayload, LinkPreview, TgUpdate } from "../types.js";
import { extractInlineKeyboard } from "./inlineKeyboard.js";
import { classifyMedia } from "./media.js";

type MdEntity = { className: string; offset: number; length: number; url?: string; language?: string };

const editUpdateSeq = new Map<string, number>();

function entitiesToMarkdown(text: string, entities?: MdEntity[]): string {
  if (!entities || entities.length === 0) return text;
  const opens = new Map<number, string[]>();
  const closes = new Map<number, string[]>();
  const add = (m: Map<number, string[]>, i: number, s: string, prepend = false) => {
    const arr = m.get(i) ?? [];
    prepend ? arr.unshift(s) : arr.push(s);
    m.set(i, arr);
  };
  for (const e of entities) {
    const end = e.offset + e.length;
    let open = "";
    let close = "";
    switch (e.className) {
      case "MessageEntityBold": open = close = "**"; break;
      case "MessageEntityItalic": open = close = "_"; break;
      case "MessageEntityStrike": open = close = "~~"; break;
      case "MessageEntityCode": open = close = "`"; break;
      case "MessageEntityPre": open = "\n```" + (e.language ?? "") + "\n"; close = "\n```\n"; break;
      case "MessageEntityBlockquote": open = "\n> "; close = "\n"; break;
      case "MessageEntityTextUrl": open = "["; close = `](${e.url ?? ""})`; break;
      default: continue;
    }
    add(opens, e.offset, open);
    add(closes, end, close, true);
  }
  let out = "";
  for (let i = 0; i <= text.length; i++) {
    for (const c of closes.get(i) ?? []) out += c;
    for (const o of opens.get(i) ?? []) out += o;
    if (i < text.length) out += text[i];
  }
  return out;
}

function cleanAgentVisibleText(text: string): string {
  let cleaned = text.replace(/\r\n?/g, "\n").trim();

  const transcriptIdx = cleaned.lastIndexOf("Transcript:");
  if (transcriptIdx >= 0) cleaned = cleaned.slice(transcriptIdx + "Transcript:".length).trim();

  cleaned = cleaned
    .replace(/(?:^|\n)\s*진행 상황[^\n]*(?=\n|$)/gi, "\n")
    .replace(/(?:^|\n)\s*(?:🛠|💻)?\s*skilldocs\s+(?:시작|완료)\s*[–-]\s*(?:\{[^\n]*\}|[^\n]*)/gi, "\n")
    .replace(/(?:^|\n)\s*(?:🛠|💻)?\s*summarize\s+(?:시작|완료)\s*[–-]\s*(?:\{[^\n]*\}|[^\n]*)/gi, "\n")
    .replace(/\s*>>\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/^확인 중 오류가 발생해 답변을 마무리하지 못했습니다!?\s*$/i.test(cleaned)) return "";
  return cleaned;
}

function inferPayload(raw: Record<string, unknown>): AgentPayload | undefined {
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return undefined;
  if (typeof raw.status === "string") return { type: "task_update", task: raw };
  if (typeof raw.kind === "string" && typeof raw.content === "string") return { type: "artifact", artifact: raw };
  if (Array.isArray(raw.fields) && typeof raw.submitLabel === "string") return { type: "form", form: raw };
  return undefined;
}

function payloadFromBlock(kind: string, json: string): AgentPayload | undefined {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (kind === "agent_task") return { type: "task_update", task: raw };
    if (kind === "agent_artifact") return { type: "artifact", artifact: raw };
    if (kind === "agent_form") return { type: "form", form: raw };
    if (raw.type === "task_update" && raw.task && typeof raw.task === "object") {
      return { type: "task_update", task: raw.task as Record<string, unknown> };
    }
    if (raw.type === "artifact" && raw.artifact && typeof raw.artifact === "object") {
      return { type: "artifact", artifact: raw.artifact as Record<string, unknown> };
    }
    if (raw.type === "form" && raw.form && typeof raw.form === "object") {
      return { type: "form", form: raw.form as Record<string, unknown> };
    }
    if (kind === "json" || kind === "") return inferPayload(raw);
  } catch {
    return undefined;
  }
  return undefined;
}

function extractAgentPayloads(text: string): { text: string; payloads: AgentPayload[] } {
  const payloads: AgentPayload[] = [];
  const cleaned = text.replace(
    /```([A-Za-z0-9_-]*)\s*\n([\s\S]*?)\n```/g,
    (_full, kind: string, json: string) => {
      const payload = payloadFromBlock(kind, json);
      if (payload) payloads.push(payload);
      return payload ? "" : _full;
    },
  ).replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, payloads };
}

function nextEditUpdateId(deviceId: string, peerId: number, messageId: number): number {
  const key = `${deviceId}:${peerId}:${messageId}`;
  const next = Math.min((editUpdateSeq.get(key) ?? 1) + 1, 998);
  editUpdateSeq.set(key, next);
  return messageId * 1000 + next;
}

export function updateFromTelegramMessage(params: {
  deviceId: string;
  peer: { peer_id: number; title: string | null };
  msg: any;
  edited?: boolean;
}): TgUpdate | null {
  const { deviceId, peer, msg } = params;
  const outgoing = !!msg.out;
  const peerId = peer.peer_id;
  const rawText: string = entitiesToMarkdown(msg.message ?? "", msg.entities as MdEntity[] | undefined);
  const visibleText = !outgoing ? cleanAgentVisibleText(rawText) : rawText;
  const extracted = !outgoing ? extractAgentPayloads(visibleText) : { text: visibleText, payloads: [] };
  const text = extracted.text;
  const mediaInfo = classifyMedia(msg);
  const inlineKeyboard = extractInlineKeyboard(msg.replyMarkup);
  if (!text && !mediaInfo && extracted.payloads.length === 0 && !inlineKeyboard) return null;

  const messageId = Number(msg.id);
  let preview: LinkPreview | undefined;
  const wp = (msg as { media?: { webpage?: any } }).media?.webpage;
  if (wp && wp.className === "WebPage" && wp.url) {
    preview = {
      url: String(wp.url),
      title: wp.title ? String(wp.title) : undefined,
      description: wp.description ? String(wp.description) : undefined,
      siteName: wp.siteName ? String(wp.siteName) : undefined,
      image: wp.photo
        ? `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${messageId}`
        : undefined,
    };
  }
  const media = mediaInfo
    ? { ...mediaInfo, url: `/media?deviceId=${encodeURIComponent(deviceId)}&peer=${peerId}&msg=${messageId}` }
    : undefined;
  const baseUpdateId = messageId * 1000;
  const eventUpdateId = params.edited ? nextEditUpdateId(deviceId, peerId, messageId) : baseUpdateId;
  return {
    update_id: eventUpdateId,
    message: {
      message_id: messageId,
      date: Number(msg.date),
      text,
      chat: { id: peerId, type: "private" },
      from: { id: peerId, is_bot: !outgoing, first_name: peer.title ?? "" },
      outgoing,
      ...(preview ? { preview } : {}),
      ...(media ? { media } : {}),
      ...(extracted.payloads.length ? { agent_payload: extracted.payloads[0], agent_payloads: extracted.payloads } : {}),
      inline_keyboard: inlineKeyboard ?? null,
    },
  };
}
