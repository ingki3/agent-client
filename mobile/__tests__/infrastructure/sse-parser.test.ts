import { drainSseBuffer } from '@/infrastructure/api/sseParser';

describe('drainSseBuffer', () => {
  it('parses a single complete frame and leaves no rest', () => {
    const { events, rest } = drainSseBuffer('data: {"type":"connected","cursor":5}\n\n');
    expect(events).toEqual(['{"type":"connected","cursor":5}']);
    expect(rest).toBe('');
  });

  it('does not consume an incomplete frame (regression: split-frame loss)', () => {
    const first = drainSseBuffer('data: {"type":"message_updated","message":{"a"');
    expect(first.events).toEqual([]);
    expect(first.rest).toBe('data: {"type":"message_updated","message":{"a"');

    const second = drainSseBuffer(first.rest + ':1}}\n\n');
    expect(second.events).toEqual(['{"type":"message_updated","message":{"a":1}}']);
    expect(second.rest).toBe('');
  });

  it('parses multiple frames arriving in one chunk', () => {
    const { events, rest } = drainSseBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}\n\n');
    expect(events).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(rest).toBe('');
  });

  it('skips heartbeat comment frames', () => {
    const { events, rest } = drainSseBuffer(': heartbeat\n\ndata: {"a":1}\n\n: heartbeat\n\n');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('');
  });

  it('emits complete frames and preserves a trailing partial frame', () => {
    const { events, rest } = drainSseBuffer('data: {"a":1}\n\ndata: {"b"');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });

  it('returns everything as rest when no boundary exists', () => {
    const { events, rest } = drainSseBuffer('data: {"a"');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"a"');
  });

  it('joins multiple data lines within one frame per the SSE spec', () => {
    const { events } = drainSseBuffer('data: line1\ndata: line2\n\n');
    expect(events).toEqual(['line1\nline2']);
  });

  it('ignores frames without a data line', () => {
    const { events, rest } = drainSseBuffer('event: ping\n\ndata: {"a":1}\n\n');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('');
  });

  it('handles empty input', () => {
    expect(drainSseBuffer('')).toEqual({ events: [], rest: '' });
  });
});
