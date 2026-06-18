// TECH_SPEC §12.7 — Hermes BigInt 미지원 일부 환경 대응.
// chat_id는 항상 string으로 직렬화하여 일관성을 유지한다.
// Telegram API는 정수형 chat_id를 보내지만 JSON.parse는 안전 정수 범위를 넘기면
// 정밀도가 손실되므로 wire-level에서 string으로 표현한다.

export type ChatId = string;

const CHAT_ID_PATTERN = /^-?\d+$/;

export function toChatId(input: string | number | bigint): ChatId {
  if (typeof input === 'string') {
    if (!CHAT_ID_PATTERN.test(input)) {
      throw new Error(`Invalid chat_id: ${input}`);
    }
    return input;
  }
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      throw new Error(`chat_id must be integer, got ${input}`);
    }
    return String(input);
  }
  return input.toString();
}

export function isChatId(value: unknown): value is ChatId {
  return typeof value === 'string' && CHAT_ID_PATTERN.test(value);
}
