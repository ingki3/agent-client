/**
 * Poll-loop manager. Runs exactly ONE getUpdates long-poll per bot_id against
 * {gateway}/bot{token}/getUpdates — making the relay the sole Telegram consumer.
 * New text updates are buffered (for app /pull) and fanned out as Expo pushes.
 */
import { config } from "./config.js";
import { store, type BotRow } from "./store.js";
import { sendPushes, type PushItem } from "./push.js";
import { log } from "./log.js";
import type { InlineKeyboard, InlineKeyboardButton, TgUpdate } from "./types.js";

type Loop = { stop: boolean; abort?: AbortController };
const loops = new Map<number, Loop>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function callGetUpdates(gateway: string, token: string, offset: number, signal: AbortSignal): Promise<TgUpdate[]> {
  const res = await fetch(`${gateway}/bot${token}/getUpdates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: config.pollTimeoutSec, allowed_updates: ["message", "edited_message"] }),
    signal,
  });
  const body = (await res.json()) as { ok: boolean; result?: TgUpdate[]; error_code?: number; description?: string };
  if (!body.ok) {
    const err = new Error(body.description ?? "getUpdates failed") as Error & { code?: number };
    err.code = body.error_code;
    throw err;
  }
  return body.result ?? [];
}

async function botTitle(gateway: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${gateway}/bot${token}/getMe`, { method: "POST" });
    const body = (await res.json()) as { ok: boolean; result?: { first_name: string } };
    return body.ok && body.result ? body.result.first_name : "Agent";
  } catch {
    return "Agent";
  }
}

function buttonStyle(label: string): InlineKeyboardButton["style"] {
  if (/삭제|취소|거절|중단|실패|delete|cancel|reject|stop/i.test(label)) return "danger";
  if (/확인|승인|완료|저장|선택|ok|confirm|approve|save|done/i.test(label)) return "success";
  return "default";
}

function inlineButtonFromBotApi(button: Record<string, unknown>, row: number, col: number): InlineKeyboardButton {
  const label = String(button.text ?? "").trim() || "버튼";
  const id = `r${row}c${col}`;
  if (typeof button.callback_data === "string") return { id, label, type: "callback", style: buttonStyle(label) };
  if (typeof button.url === "string") return { id, label, type: "url", url: button.url, style: "primary" };
  const webApp = button.web_app as { url?: unknown } | undefined;
  if (webApp && typeof webApp.url === "string") return { id, label, type: "web_app", url: webApp.url, style: "primary" };
  const loginUrl = button.login_url as { url?: unknown } | undefined;
  if (loginUrl && typeof loginUrl.url === "string") return { id, label, type: "login_url", url: loginUrl.url, style: "primary" };
  if (typeof button.switch_inline_query === "string" || typeof button.switch_inline_query_current_chat === "string") {
    return { id, label, type: "switch_inline", disabled: true };
  }
  const copyText = button.copy_text as { text?: unknown } | undefined;
  if (copyText && typeof copyText.text === "string") return { id, label, type: "copy", copyText: copyText.text, style: "default" };
  return { id, label, type: "unsupported", disabled: true };
}

function extractBotApiInlineKeyboard(replyMarkup: unknown): InlineKeyboard | undefined {
  const markup = replyMarkup as { inline_keyboard?: unknown } | undefined;
  if (!Array.isArray(markup?.inline_keyboard)) return undefined;
  const rows = markup.inline_keyboard
    .map((row, ri) => Array.isArray(row) ? row.map((button, ci) => inlineButtonFromBotApi(button as Record<string, unknown>, ri, ci)) : [])
    .filter((row: InlineKeyboardButton[]) => row.length > 0);
  return rows.length ? { rows } : undefined;
}

function normalizeUpdateInlineKeyboard(update: TgUpdate): TgUpdate {
  const next = structuredClone(update) as TgUpdate;
  const message = next.message ?? next.edited_message;
  if (!message) return next;
  const rawMessage = message as typeof message & { reply_markup?: unknown };
  const inlineKeyboard = extractBotApiInlineKeyboard(rawMessage.reply_markup);
  if (inlineKeyboard) message.inline_keyboard = inlineKeyboard;
  return next;
}

function runLoop(bot: BotRow) {
  const loop: Loop = { stop: false };
  loops.set(bot.bot_id, loop);

  void (async () => {
    const token = store.decryptToken(bot);
    const title = await botTitle(bot.gateway, token);
    let offset = bot.tg_offset;
    let backoff = 1000;
    log.info(`loop start bot=${bot.bot_id} gateway=${bot.gateway} offset=${offset}`);

    while (!loop.stop) {
      try {
        const abort = new AbortController();
        loop.abort = abort;
        const updates = await callGetUpdates(bot.gateway, token, offset, abort.signal);
        backoff = 1000;

        const pushes: PushItem[] = [];
        for (const u of updates) {
          offset = u.update_id + 1;
          const normalized = normalizeUpdateInlineKeyboard(u);
          const m = normalized.message ?? normalized.edited_message;
          if (!m?.text && !m?.inline_keyboard) continue;
          if (store.hasUpdate(bot.bot_id, u.update_id)) continue;
          store.insertUpdate(bot.bot_id, normalized);
          for (const t of store.pushTargets(bot.bot_id)) {
            pushes.push({ expoPushToken: t.expo_push_token, botTitle: title, m, updateId: u.update_id, buddyId: t.buddy_id });
          }
        }
        store.setOffset(bot.bot_id, offset);
        if (pushes.length) await sendPushes(pushes);
      } catch (e) {
        if (loop.stop) break;
        const code = (e as { code?: number }).code;
        if (code === 409) {
          log.warn(`bot=${bot.bot_id} 409 conflict (another getUpdates consumer / webhook) — backing off`);
          await sleep(5000);
        } else if ((e as Error).name === "AbortError") {
          // stopped intentionally
        } else {
          log.warn(`bot=${bot.bot_id} poll error: ${(e as Error).message}`);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    }
    log.info(`loop stop bot=${bot.bot_id}`);
  })();
}

/** Reconcile running loops with the DB: start missing, stop orphaned. */
export function reconcileLoops() {
  store.pruneUpdates();
  const reaped = store.reapOrphanBots();
  for (const botId of reaped) {
    const l = loops.get(botId);
    if (l) {
      l.stop = true;
      l.abort?.abort();
      loops.delete(botId);
    }
  }
  for (const bot of store.activeBots()) {
    if (!loops.has(bot.bot_id)) runLoop(bot);
  }
}

export function loopCount(): number {
  return loops.size;
}
