import { config } from "./config.js";
import { chatJson } from "./llm.js";
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

const helperJsonContract = [
  'Return exactly one JSON object. The first character must be "{".',
  'Empty response shape: {"version":"1","items":[]}',
  "Allowed item types:",
  'quick_replies: {"type":"quick_replies","id":"qr_1","options":[{"label":"짧은 버튼명","value":"agent에게 보낼 구체적인 자연어 지시"}]}',
  'single_select: {"type":"single_select","id":"sel_1","title":"제목","options":[{"label":"...","value":"..."}],"submitLabel":"전송"}',
  'multi_select: {"type":"multi_select","id":"multi_1","title":"제목","options":[{"label":"...","value":"..."}],"submitLabel":"전송"}',
  'input_form: {"type":"input_form","id":"form_1","title":"제목","fields":[{"id":"field_1","kind":"text","label":"입력"}],"submitLabel":"전송"}',
  'confirm_action: {"type":"confirm_action","id":"confirm_1","title":"제목","confirmLabel":"진행"}',
  'artifact_suggestion: {"type":"artifact_suggestion","id":"artifact_1","title":"제목","artifact":{"kind":"checklist","title":"제목","content":"내용"}}',
  "Use 0 to 2 items. Prefer quick_replies. Use forms only when details are missing.",
].join("\n");

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
  const raw = await chatJson<HelperEnvelope>({
    label: "helper",
    fallback: empty,
    timeoutMs,
    temperature: 0.1,
    maxTokens: config.llmHelperMaxTokens,
    messages: [
      {
        role: "system",
        content: [
          "/no_think",
          "You create follow-up UI JSON for a mobile messenger.",
          "Never write prose, markdown, commentary, or reasoning.",
          helperJsonContract,
        ].join("\n"),
      },
      { role: "user", content: prompt },
    ],
  });
  return normalize(raw, agentText);
}

export async function suggestHelperItems(input: {
  buddyTitle: string;
  agentText: string;
  recentMessages: string[];
}): Promise<HelperItem[]> {
  if (!config.helperEnabled || !input.agentText.trim()) return [];
  const prompt = [
    "Read the agent reply and create useful next-action UI for the human.",
    "Output JSON only according to the contract. No explanation.",
    "Return no items when no meaningful follow-up is needed, such as greetings, acknowledgements, short factual answers, or completed confirmations.",
    "Prefer at most two quick_replies for simple follow-ups. Use forms only when the user likely needs to choose or provide missing details.",
    "For long analytical answers, ranked lists, investment/market summaries, product comparisons, or multi-section reports, usually create 1-2 grounded quick_replies that help the human continue naturally.",
    "If the reply compares options, mentions risks, lists next steps, or offers to prepare a checklist, create quick_replies.",
    'Example quick reply item: {"type":"quick_replies","id":"qr_followup","options":[{"label":"리스크 비교","value":"방금 비교한 후보들의 보안 리스크와 운영 부담을 표로 정리해줘."},{"label":"체크리스트","value":"방금 답변 기준으로 내일 확인할 체크리스트를 만들어줘."}]}',
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
