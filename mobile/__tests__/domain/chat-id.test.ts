import { isChatId, toChatId } from '@/domain/value-objects/ChatId';

describe('ChatId value object — TECH §12.7 BigInt safety', () => {
  it('accepts numeric strings unchanged', () => {
    expect(toChatId('9876543210123')).toBe('9876543210123');
  });

  it('accepts negative ids (group chats)', () => {
    expect(toChatId('-1001234567890')).toBe('-1001234567890');
  });

  it('coerces safe integer numbers to string', () => {
    expect(toChatId(123)).toBe('123');
  });

  it('coerces bigint to string preserving precision', () => {
    expect(toChatId(9007199254740993n)).toBe('9007199254740993');
  });

  it('rejects non-numeric strings', () => {
    expect(() => toChatId('abc')).toThrow();
    expect(() => toChatId('123.45')).toThrow();
  });

  it('isChatId guard rejects non-strings', () => {
    expect(isChatId('123')).toBe(true);
    expect(isChatId(123)).toBe(false);
    expect(isChatId(null)).toBe(false);
    expect(isChatId('not-a-number')).toBe(false);
  });
});
