/**
 * Telegram-compatible Bot API client (PRD FR-16, TECH_SPEC §12.1).
 *
 * Every call hits `{gateway}/bot{token}/{method}` and expects the Telegram envelope
 * `{ ok: true, result } | { ok: false, error_code, description }`. With the default
 * gateway (api.telegram.org) this talks to real Telegram bots; point `config.gateway`
 * at an Agent Gateway to add trace/delta extensions on top of the same protocol.
 */
import { config } from "../config";
import type { AgentPayload, HelperItem, InlineKeyboard } from "@/domain/entities";

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
};

export type TgMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: TgUser;
  /** Relay (MTProto) sets this for messages the user sent (from any client) → render as "user". */
  outgoing?: boolean;
  /** Telegram webpage link preview; `image` is a relay path (prepend config.relayBase). */
  preview?: { url: string; title?: string; description?: string; siteName?: string; image?: string };
  /** Attached media; `url` is a relay path (prepend config.relayBase) that proxies the bytes. */
  media?: { kind: string; name: string; mime: string; size?: number; url: string };
  agent_payload?: AgentPayload;
  agent_payloads?: AgentPayload[];
  helper_items?: HelperItem[];
  inline_keyboard?: InlineKeyboard | null;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
};

export class BotApiError extends Error {
  constructor(
    public code: number,
    public description: string,
  ) {
    super(`Bot API ${code}: ${description}`);
    this.name = "BotApiError";
  }
}

type Envelope<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

async function call<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
	): Promise<T> {
	  const url = `${config.gateway}/bot${token}/${method}`;
	  const init: RequestInit = {
	    method: "POST",
	    headers: { "Content-Type": "application/json" },
	  };
	  if (params !== undefined) init.body = JSON.stringify(params);
	  if (signal !== undefined) init.signal = signal;
	  const res = await fetch(url, init);

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new BotApiError(res.status, res.statusText || "Invalid JSON response");
  }

  if (!body.ok) {
    throw new BotApiError(body.error_code, body.description);
  }
  return body.result;
}

export const botApi = {
  /** Validate a token and fetch bot metadata for the add-buddy preview (S-12 → S-13). */
  getMe(token: string, signal?: AbortSignal): Promise<TgUser> {
    return call<TgUser>(token, "getMe", undefined, signal);
  },

  sendMessage(
    token: string,
    chatId: number | string,
    text: string,
    signal?: AbortSignal,
  ): Promise<TgMessage> {
    return call<TgMessage>(token, "sendMessage", { chat_id: chatId, text }, signal);
  },

  editMessageText(
    token: string,
    chatId: number | string,
    messageId: number,
    text: string,
    signal?: AbortSignal,
  ): Promise<TgMessage | true> {
    return call<TgMessage | true>(
      token,
      "editMessageText",
      { chat_id: chatId, message_id: messageId, text },
      signal,
    );
  },

  /** Typing indicator while the agent works. Best-effort — failures are swallowed by callers. */
  sendChatAction(
    token: string,
    chatId: number | string,
    action: "typing" = "typing",
    signal?: AbortSignal,
  ): Promise<boolean> {
    return call<boolean>(token, "sendChatAction", { chat_id: chatId, action }, signal);
  },

  /**
   * Long-poll for updates. `offset` should be the last seen update_id + 1.
   * `timeout` is the server-side long-poll window in seconds.
   */
  getUpdates(
    token: string,
    offset: number,
    timeout = 25,
    signal?: AbortSignal,
  ): Promise<TgUpdate[]> {
    return call<TgUpdate[]>(
      token,
      "getUpdates",
      { offset, timeout, allowed_updates: ["message", "edited_message"] },
      signal,
    );
  },
};
