import { config } from "./config.js";
import { log } from "./log.js";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null };
    text?: string | null;
  }>;
  error?: { message?: string };
};

let activeRequests = 0;
const waiters: Array<() => void> = [];

function chatCompletionsUrl(): string {
  return `${config.llmBaseUrl}/chat/completions`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLlmSlot(): Promise<void> {
  if (activeRequests < config.llmConcurrency) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      activeRequests += 1;
      resolve();
    });
  });
}

function releaseLlmSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = waiters.shift();
  if (next) next();
}

async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLlmSlot();
  try {
    return await fn();
  } finally {
    releaseLlmSlot();
  }
}

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*<think>[\s\S]*$/i, "")
    .trim();
}

export function extractJsonText(text: string): string {
  const stripped = stripThinking(text);
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? stripped).trim();
  if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;

  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return candidate.slice(objectStart, objectEnd + 1);

  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return candidate.slice(arrayStart, arrayEnd + 1);

  return candidate;
}

async function postChatCompletion(params: {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonObject: boolean;
}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs);
  try {
    return await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.llmApiKey ? { Authorization: `Bearer ${config.llmApiKey}` } : {}),
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: config.llmModel,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(params.jsonObject ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function postChatCompletionWithRetry(params: {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonObject: boolean;
  label: string;
}): Promise<Response> {
  return withLlmSlot(async () => {
    let last: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await postChatCompletion(params);
      if (res.status !== 503 && res.status !== 429) return res;
      last = res;
      const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * attempt;
      const body = await res.text().catch(() => "");
      log.warn(`${params.label} llm busy status=${res.status} attempt=${attempt} retry_ms=${delayMs} ${body.slice(0, 200)}`);
      await sleep(delayMs);
    }
    return last!;
  });
}

export async function chatJson<T>(params: {
  messages: ChatMessage[];
  fallback: T;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  label: string;
}): Promise<T> {
  const temperature = params.temperature ?? 0.1;
  const maxTokens = params.maxTokens ?? config.llmMaxTokens;
  const timeoutMs = params.timeoutMs ?? 30000;

  for (const jsonObject of [true, false]) {
    try {
      const res = await postChatCompletionWithRetry({
        messages: params.messages,
        temperature,
        maxTokens,
        timeoutMs,
        jsonObject,
        label: params.label,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.warn(`${params.label} llm failed status=${res.status} model=${config.llmModel} response_format=${jsonObject ? "json_object" : "none"} ${body.slice(0, 240)}`);
        if (jsonObject && (res.status === 400 || res.status === 404 || res.status === 422)) continue;
        return params.fallback;
      }
      const body = (await res.json()) as ChatCompletionResponse;
      const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
      if (!content) {
        log.warn(`${params.label} llm returned empty content model=${config.llmModel}`);
        return params.fallback;
      }
      try {
        return JSON.parse(extractJsonText(content)) as T;
      } catch (e) {
        log.warn(`${params.label} llm invalid json model=${config.llmModel} response_format=${jsonObject ? "json_object" : "none"} error=${(e as { message?: string })?.message ?? String(e)} content=${content.slice(0, 240)}`);
        return params.fallback;
      }
    } catch (e) {
      log.warn(`${params.label} llm error model=${config.llmModel}: ${(e as { message?: string })?.message ?? String(e)}`);
      return params.fallback;
    }
  }
  return params.fallback;
}

/**
 * Plain-text completion. Use this when the model's whole answer IS the output
 * (e.g. a TTS script) — wrapping such text in JSON is fragile: a long answer
 * that hits max_tokens leaves the JSON string unterminated, and any literal
 * newline in the value makes JSON.parse throw. Returning the raw content sidesteps
 * both, and a truncated plain answer is still usable text.
 */
export async function chatText(params: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  label: string;
}): Promise<string | null> {
  const temperature = params.temperature ?? 0.1;
  const maxTokens = params.maxTokens ?? config.llmMaxTokens;
  const timeoutMs = params.timeoutMs ?? 30000;
  try {
    const res = await postChatCompletionWithRetry({
      messages: params.messages,
      temperature,
      maxTokens,
      timeoutMs,
      jsonObject: false,
      label: params.label,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`${params.label} llm failed status=${res.status} model=${config.llmModel} ${body.slice(0, 240)}`);
      return null;
    }
    const body = (await res.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
    if (!content) {
      log.warn(`${params.label} llm returned empty content model=${config.llmModel}`);
      return null;
    }
    return stripThinking(content).trim() || null;
  } catch (e) {
    log.warn(`${params.label} llm error model=${config.llmModel}: ${(e as { message?: string })?.message ?? String(e)}`);
    return null;
  }
}
