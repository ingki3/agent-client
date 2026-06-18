import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./llm.js";
import { log } from "./log.js";
import type { TtsMode } from "./types.js";

type ScriptEnvelope = { script?: string };

const scriptSchema = {
  type: "object",
  properties: {
    script: { type: "string" },
  },
  required: ["script"],
};

function limit(input: string, max: number): string {
  const text = input.trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function stripForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "링크")
    .replace(/[#*_~>|]+/g, " ")
    .replace(/[🤖🐧🔥📌✅❌⚠️🎙️🎵📎🖼️🎬]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modeInstruction(mode: TtsMode): string {
  if (mode === "brief") {
    return [
      "모드: 요약.",
      "원문을 그대로 읽지 말고, 사람이 읽어주는 짧은 오디오 스크립트로 새로 작성하세요.",
      "핵심 내용만 골라 30~60초 안에 들을 수 있게 짧게 말하세요.",
      "세부 근거와 주변 설명은 과감히 줄이고, 사용자가 지금 알아야 할 결론을 먼저 말하세요.",
    ].join("\n");
  }
  if (mode === "action_items") {
    return [
      "모드: 다음 액션.",
      "원문을 그대로 읽지 말고, 사람이 읽어주는 실행 중심 오디오 스크립트로 새로 작성하세요.",
      "글 내용을 보고 사용자가 판단해야 할 것, 확인해야 할 것, 해야 할 액션을 중심으로 설명하세요.",
      "명시적인 할 일이 없어도 다음에 검토할 선택지나 의사결정 포인트를 정리하세요.",
      "액션은 우선순위가 느껴지게 말하되, 억지로 없는 일을 만들지는 마세요.",
    ].join("\n");
  }
  return [
    "모드: 대화형.",
    "원문을 그대로 읽지 말고, 사람이 옆에서 읽어주는 방식의 자세한 오디오 스크립트로 새로 작성하세요.",
    "사용자가 화면을 보지 않아도 맥락을 이해하도록 중요한 배경, 이유, 흐름을 상세히 설명하세요.",
    "대화하듯 자연스럽게 풀어 말하되, 1~3분 정도로 듣기 편하게 구성하세요.",
  ].join("\n");
}

export function buildTtsScriptPrompt(text: string, mode: TtsMode): string {
  return [
    "You rewrite an AI agent reply into a Korean TTS script for a mobile messenger.",
    "듣기 요청이 들어오면 기본적으로 문서를 낭독하지 말고, 사람이 읽어주는 오디오용 스크립트를 새로 작성하세요.",
    modeInstruction(mode),
    "Use natural spoken Korean, as if a helpful person is explaining it in a chat.",
    "Preserve the agent's recognizable speech level, energy, recurring phrases, and light personality when they are visible in the reply.",
    "Do not flatten a casual reply into a formal report. Do not overdo the persona or add new catchphrases that were not implied.",
    "Do not mention markdown, tools, JSON, or hidden system details.",
    "If the reply contains URLs, mention the content only if it is visible in the reply; otherwise say the link can be checked on screen.",
    "Avoid reading emojis and symbols aloud. Keep sentences short enough to listen to comfortably.",
    "",
    `Agent reply:\n${limit(text, config.ttsMaxInputChars)}`,
  ].join("\n");
}

async function generateScriptWithLlm(text: string, mode: TtsMode): Promise<string | null> {
  const prompt = buildTtsScriptPrompt(text, mode);
  const parsed = await chatJson<ScriptEnvelope>({
    label: "tts script",
    fallback: {},
    timeoutMs: 30000,
    temperature: 0.1,
    maxTokens: config.llmTtsMaxTokens,
    messages: [
      {
        role: "system",
        content: [
          "/no_think",
          "You create Korean text-to-speech scripts.",
          "Return ONLY valid JSON. Do not wrap it in markdown.",
          "Do not explain your reasoning. Do not include analysis text.",
          "The JSON must match this schema:",
          JSON.stringify(scriptSchema),
        ].join("\n"),
      },
      { role: "user", content: prompt },
    ],
  });
  return typeof parsed.script === "string" ? stripForSpeech(parsed.script) : null;
}

export async function createTtsScript(input: { text: string; mode: TtsMode }): Promise<string> {
  const base = stripForSpeech(limit(input.text, config.ttsMaxInputChars));
  if (!base) return "";
  const scripted = await generateScriptWithLlm(base, input.mode);
  const minUsefulLength = input.mode === "brief" ? 24 : 40;
  const usable = scripted && scripted.length >= minUsefulLength ? scripted : base;
  return limit(usable, input.mode === "brief" ? 900 : 2400);
}

function cacheKeyOf(input: { text: string; script: string; mode: TtsMode; voice: string; rate: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ provider: config.ttsProvider, ...input }))
    .digest("hex")
    .slice(0, 32);
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function generateWithEdgeTts(script: string, voice: string, filePath: string): Promise<void> {
  await runCommand(
    "uvx",
    ["edge-tts", "--voice", voice, "--rate", config.ttsRate, "--text", script, "--write-media", filePath],
    90000,
  );
}

async function generateWithSay(script: string, filePath: string): Promise<void> {
  const aiff = filePath.replace(/\.mp3$/i, ".aiff");
  await runCommand("say", ["-v", "Yuna", "-o", aiff, script], 90000);
  await runCommand("ffmpeg", ["-y", "-i", aiff, "-codec:a", "libmp3lame", "-q:a", "4", filePath], 90000);
}

export async function createTtsAudio(input: {
  text: string;
  mode: TtsMode;
  voice?: string;
}): Promise<{ cacheKey: string; filePath: string; script: string; generated: boolean }> {
  if (!config.ttsEnabled) throw new Error("tts_disabled");
  const script = await createTtsScript({ text: input.text, mode: input.mode });
  if (!script) throw new Error("empty_tts_script");
  const voice = input.voice || config.ttsVoice;
  const cacheKey = cacheKeyOf({ text: limit(input.text, config.ttsMaxInputChars), script, mode: input.mode, voice, rate: config.ttsRate });
  await mkdir(config.ttsCacheDir, { recursive: true });
  const filePath = path.join(config.ttsCacheDir, `${cacheKey}.mp3`);
  if (await exists(filePath)) return { cacheKey, filePath, script, generated: false };

  try {
    await generateWithEdgeTts(script, voice, filePath);
  } catch (e) {
    log.warn(`edge-tts failed voice=${voice}: ${(e as { message?: string })?.message ?? String(e)}`);
    try {
      await generateWithEdgeTts(script, config.ttsFallbackVoice, filePath);
    } catch (fallback) {
      log.warn(`edge-tts fallback failed: ${(fallback as { message?: string })?.message ?? String(fallback)}`);
      await generateWithSay(script, filePath);
    }
  }

  return { cacheKey, filePath, script, generated: true };
}

export function resolveTtsFile(cacheKey: string): string | null {
  if (!/^[a-f0-9]{32}$/i.test(cacheKey)) return null;
  return path.join(config.ttsCacheDir, `${cacheKey}.mp3`);
}
