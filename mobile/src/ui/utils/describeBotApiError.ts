import { BotApiError } from '@/domain/rules/BotApiError';

/**
 * Korean copy for the BotApiError kinds shared across add-buddy screens.
 * Returns null for kinds a screen wants to phrase itself (callers supply their
 * own fallback for those).
 */
export function describeBotApiError(err: BotApiError): string | null {
  if (err.kind === 'invalid_token') return '유효하지 않은 토큰입니다.';
  if (err.kind === 'network_error') return '네트워크에 연결할 수 없습니다.';
  return null;
}
