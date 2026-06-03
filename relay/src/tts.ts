import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
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
  if (mode === "brief") return "Create a 30 to 60 second conversational Korean spoken summary.";
  if (mode === "action_items") {
    return "Create a concise Korean spoken script focused on useful next actions, decisions, or things to verify. If the reply has no literal tasks, frame them as optional next checks.";
  }
  return "Create a natural Korean spoken explanation for listening, around 1 to 3 minutes.";
}

async function generateScriptWithGemini(text: string, mode: TtsMode): Promise<string | null> {
  if (!config.geminiApiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const prompt = [
    "You rewrite an AI agent reply into a Korean TTS script for a mobile messenger.",
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
            responseSchema: scriptSchema,
          },
        }),
      },
    );
    if (!res.ok) {
      log.warn(`tts script gemini failed status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScriptEnvelope;
    return typeof parsed.script === "string" ? stripForSpeech(parsed.script) : null;
  } catch (e) {
    log.warn(`tts script failed: ${(e as { message?: string })?.message ?? String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function createTtsScript(input: { text: string; mode: TtsMode }): Promise<string> {
  const base = stripForSpeech(limit(input.text, config.ttsMaxInputChars));
  if (!base) return "";
  const scripted = await generateScriptWithGemini(base, input.mode);
  return limit(scripted || base, input.mode === "brief" ? 900 : 2400);
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
