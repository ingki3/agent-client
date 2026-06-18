import { BotApiError, mapHttpStatusToKind } from '@/domain/rules/BotApiError';

import type {
  EditMessageTextParams,
  GetUpdatesParams,
  SendChatActionParams,
  SendMessageParams,
  TgBotUser,
  TgMessage,
  TgResultEnvelope,
  TgUpdate,
} from './types';

export interface BotApiClientOptions {
  /** Telegram-호환 게이트웨이 호스트. 예: `https://api.telegram.org` */
  gateway: string;
  /** 단위 ms. 첫 응답까지 대기. */
  requestTimeoutMs?: number;
  /** 테스트 주입용. 기본은 globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class BotApiClient {
  private readonly gateway: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BotApiClientOptions) {
    this.gateway = options.gateway.replace(/\/$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const provided = options.fetchImpl;
    if (provided) {
      this.fetchImpl = provided;
    } else if (typeof globalThis.fetch === 'function') {
      this.fetchImpl = globalThis.fetch.bind(globalThis);
    } else {
      throw new Error('No fetch implementation available; pass fetchImpl explicitly.');
    }
  }

  getMe(token: string, signal?: AbortSignal): Promise<TgBotUser> {
    return this.call(token, 'getMe', undefined, signal);
  }

  sendMessage(token: string, params: SendMessageParams, signal?: AbortSignal): Promise<TgMessage> {
    return this.call(token, 'sendMessage', params, signal);
  }

  editMessageText(
    token: string,
    params: EditMessageTextParams,
    signal?: AbortSignal,
  ): Promise<TgMessage> {
    return this.call(token, 'editMessageText', params, signal);
  }

  getUpdates(
    token: string,
    params: GetUpdatesParams = {},
    signal?: AbortSignal,
  ): Promise<TgUpdate[]> {
    return this.call(token, 'getUpdates', params, signal);
  }

  sendChatAction(
    token: string,
    params: SendChatActionParams,
    signal?: AbortSignal,
  ): Promise<true> {
    return this.call(token, 'sendChatAction', params, signal);
  }

  private async call<T>(
    token: string,
    method: string,
    body: unknown,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    if (!token) {
      throw new BotApiError('invalid_token', { description: 'Empty token' });
    }
    const url = `${this.gateway}/bot${token}/${method}`;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? '{}' : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === 'AbortError' || controller.signal.aborted);
      if (aborted) {
        const externalAborted = externalSignal?.aborted === true;
        throw new BotApiError(externalAborted ? 'aborted' : 'network_error', {
          description: externalAborted ? 'Request aborted by caller' : 'Request timed out',
          cause: err,
        });
      }
      throw new BotApiError('network_error', {
        description: err instanceof Error ? err.message : String(err),
        cause: err,
      });
    } finally {
      clearTimeout(timeoutHandle);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    let payload: TgResultEnvelope<T> | undefined;
    try {
      payload = (await response.json()) as TgResultEnvelope<T>;
    } catch (err) {
      throw new BotApiError('parse_error', {
        httpStatus: response.status,
        description: 'Invalid JSON in Bot API response',
        cause: err,
      });
    }

    if (!response.ok) {
      const errorEnvelope =
        payload && payload.ok === false ? payload : undefined;
      throw new BotApiError(mapHttpStatusToKind(response.status), {
        httpStatus: response.status,
        errorCode: errorEnvelope?.error_code ?? null,
        description: errorEnvelope?.description ?? `HTTP ${response.status}`,
      });
    }

    if (!payload.ok) {
      throw new BotApiError(payload.error_code === 401 ? 'invalid_token' : 'bad_request', {
        httpStatus: response.status,
        errorCode: payload.error_code,
        description: payload.description,
      });
    }

    return payload.result;
  }
}
