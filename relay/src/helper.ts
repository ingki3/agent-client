import { config } from "./config.js";
import { log } from "./log.js";
import type { HelperEnvelope, HelperItem } from "./types.js";

const empty: HelperEnvelope = { version: "1", items: [] };

const itemSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["quick_replies", "single_select", "multi_select", "input_form", "confirm_action", "artifact_suggestion"] },
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "string" } },
        required: ["label", "value"],
      },
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["text", "textarea", "number", "date", "single_select", "multi_select", "confirm"] },
          label: { type: "string" },
          required: { type: "boolean" },
          placeholder: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, value: { type: "string" } },
              required: ["label", "value"],
            },
          },
        },
        required: ["id", "kind", "label"],
      },
    },
    submitLabel: { type: "string" },
    cancelLabel: { type: "string" },
    confirmLabel: { type: "string" },
    reviseLabel: { type: "string" },
    summary: { type: "array", items: { type: "string" } },
    artifact: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["markdown", "code", "table", "json", "file", "checklist"] },
        title: { type: "string" },
        content: { type: "string" },
        language: { type: "string" },
      },
      required: ["kind", "title", "content"],
    },
  },
  required: ["type", "id"],
};

const envelopeSchema = {
  type: "object",
  properties: {
    version: { type: "string", enum: ["1"] },
    items: { type: "array", items: itemSchema, maxItems: 3 },
  },
  required: ["version", "items"],
};

function validItem(x: unknown): x is HelperItem {
  if (!x || typeof x !== "object") return false;
  const it = x as Record<string, unknown>;
  if (typeof it.type !== "string" || typeof it.id !== "string") return false;
  if (it.type === "quick_replies") return Array.isArray(it.options) && it.options.length > 0;
  if (it.type === "single_select" || it.type === "multi_select") {
    return typeof it.title === "string" && Array.isArray(it.options) && typeof it.submitLabel === "string";
  }
  if (it.type === "input_form") return typeof it.title === "string" && Array.isArray(it.fields) && typeof it.submitLabel === "string";
  if (it.type === "confirm_action") return typeof it.title === "string" && typeof it.confirmLabel === "string";
  if (it.type === "artifact_suggestion") return typeof it.title === "string" && !!it.artifact;
  return false;
}

function compactText(x: string): string {
  return x.replace(/\s+/g, " ").trim().toLowerCase();
}

function duplicateOption(a: { label: string; value: string }, b: { label: string; value: string }): boolean {
  const al = compactText(a.label);
  const bl = compactText(b.label);
  const av = compactText(a.value);
  const bv = compactText(b.value);
  return al === bl || av === bv || (al.length > 8 && (al.includes(bl) || bl.includes(al)));
}

function genericOption(opt: { label: string; value: string }, agentText: string): boolean {
  const label = compactText(opt.label);
  const value = compactText(opt.value);
  const answer = compactText(agentText);
  if (label.length < 2 || value.length < 6) return true;
  if (/^(확인|보기|더 보기|자세히|요약|다시|계속|진행|알려줘|해줘)$/.test(label)) return true;
  if (/^(ok|yes|no|confirm|cancel|continue|view|summarize|details|more)$/i.test(value)) return true;
  if (answer && value === answer.slice(0, value.length)) return true;
  return false;
}

function polishItem(item: HelperItem, agentText: string): HelperItem | null {
  if (item.type !== "quick_replies") return item;
  const options: Array<{ label: string; value: string }> = [];
  for (const opt of item.options) {
    if (genericOption(opt, agentText)) continue;
    if (options.some((existing) => duplicateOption(existing, opt))) continue;
    options.push({
      label: opt.label.slice(0, 28),
      value: opt.value.length > 420 ? `${opt.value.slice(0, 419)}…` : opt.value,
    });
    if (options.length >= 2) break;
  }
  return options.length ? { ...item, options } : null;
}

function normalize(raw: unknown, agentText = ""): HelperEnvelope {
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as { version?: unknown; items?: unknown };
  if (r.version !== "1" || !Array.isArray(r.items)) return empty;
  const items = r.items
    .filter(validItem)
    .map((item) => polishItem(item, agentText))
    .filter((item): item is HelperItem => !!item)
    .slice(0, 2);
  return { version: "1", items };
}

async function generateHelperEnvelope(prompt: string, timeoutMs: number, agentText: string): Promise<HelperEnvelope> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.helperModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: envelopeSchema,
          },
        }),
      },
    );
    if (!res.ok) {
      log.warn(`helper gemini failed status=${res.status}`);
      return empty;
    }
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return empty;
    return normalize(JSON.parse(text), agentText);
  } finally {
    clearTimeout(t);
  }
}

export async function suggestHelperItems(input: {
  buddyTitle: string;
  agentText: string;
  recentMessages: string[];
}): Promise<HelperItem[]> {
  if (!config.helperEnabled || !config.geminiApiKey || !input.agentText.trim()) return [];
  const prompt = [
    "You are a mobile messenger UI helper. Read the agent reply and create useful next-action UI for the human.",
    "Return no items when no meaningful follow-up is needed, such as greetings, acknowledgements, short factual answers, or completed confirmations.",
    "Prefer at most two quick_replies for simple follow-ups. Use forms only when the user likely needs to choose or provide missing details.",
    "For long analytical answers, ranked lists, investment/market summaries, product comparisons, or multi-section reports, usually create 1-2 grounded quick_replies that help the human continue naturally.",
    "Good follow-ups for list/report answers include comparing named items, drilling into one named item, checking risks, asking for a concise checklist, or requesting current data for a named item.",
    "Do not create follow-ups only because a YouTube/video/webpage URL exists; the mobile client already renders URL preview cards.",
    "Create link-related follow-ups only when the agent reply contains actual link contents/results or explicitly asks what to do with the link.",
    "For quick_replies, values must be explicit natural-language instructions grounded in this exact agent reply, not generic command tokens.",
    "When an action targets a specific item from the reply, include enough identifying detail in the option value so the agent acts only on that item and scope.",
    "Do not create broad actions that could affect unrelated data unless the agent reply explicitly asked for broad handling.",
    "Do not create actions for incomplete-looking replies, partial transcripts, progress logs, or answers that appear cut off mid-sentence.",
    "Never repeat the agent answer. Generate UI affordances only.",
    "",
    `Buddy: ${input.buddyTitle}`,
    `Recent context:\n${input.recentMessages.join("\n")}`,
    `Agent reply:\n${input.agentText}`,
  ].join("\n");
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return (await generateHelperEnvelope(prompt, 30000, input.agentText)).items;
    } catch (e) {
      lastError = e;
      if (attempt === 1) log.warn(`helper attempt ${attempt} failed: ${(e as { message?: string })?.message ?? String(e)}`);
    }
  }
  log.warn(`helper failed: ${(lastError as { message?: string })?.message ?? String(lastError)}`);
  return [];
}
