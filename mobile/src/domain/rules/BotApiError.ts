export type BotApiErrorKind =
  | 'invalid_token'
  | 'bad_request'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'aborted'
  | 'parse_error'
  | 'unknown';

export class BotApiError extends Error {
  readonly kind: BotApiErrorKind;
  readonly httpStatus: number | null;
  readonly errorCode: number | null;
  readonly description: string | null;

  constructor(
    kind: BotApiErrorKind,
    options: {
      httpStatus?: number | null;
      errorCode?: number | null;
      description?: string | null;
      cause?: unknown;
    } = {},
  ) {
    const desc = options.description ?? kind;
    super(desc);
    this.name = 'BotApiError';
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.errorCode = options.errorCode ?? null;
    this.description = options.description ?? null;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function mapHttpStatusToKind(status: number): BotApiErrorKind {
  if (status === 401) return 'invalid_token';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'server_error';
  return 'unknown';
}
