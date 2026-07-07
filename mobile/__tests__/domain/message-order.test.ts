import { selectVisibleMessages, sortConversationChronology } from '@/domain/messages/duplicateMessages';
import type { Message } from '@/domain/entities/Message';

function msg(id: string, role: Message['role'], createdAt: number, text = id): Message {
  return { id, clientMessageId: id, buddyId: 'b1', role, text, status: 'sent', createdAt, traceId: null };
}

/** A locally-created optimistic row: distinct client id, wall-clock ms createdAt,
 *  server id only once the send is confirmed (null while pending). */
function localMsg(
  clientMessageId: string,
  role: Message['role'],
  createdAt: number,
  id: string | null,
  text = clientMessageId,
): Message {
  return { id, clientMessageId, buddyId: 'b1', role, text, status: id ? 'sent' : 'sending', createdAt, traceId: null };
}

describe('sortConversationChronology', () => {
  it('breaks same-createdAt ties by numeric server id (reply never above its question)', () => {
    // Telegram date is second-precision: a user question and the agent's instant
    // reply can share createdAt. The higher message id must sort after.
    const question = msg('8471', 'user', 1783232919000, '우리집에 전등이 나갔는데?');
    const answer = msg('8472', 'agent', 1783232919000, '그 제품은 ...');
    const sorted = sortConversationChronology([answer, question]);
    expect(sorted.map((m) => m.id)).toEqual(['8471', '8472']);
  });

  it('orders strictly by createdAt when it differs', () => {
    const a = msg('a', 'agent', 1000);
    const b = msg('b', 'user', 3000);
    const c = msg('c', 'agent', 2000);
    expect(sortConversationChronology([a, b, c]).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  // Regression: "순서 꼬임" — the server sequence (message_id), not createdAt,
  // is the source of truth. createdAt mixes clocks (remote = Telegram
  // second-precision date, local = phone ms wall clock) and inverts pairs.
  it('keeps a confirmed question above its same-second reply even though the local ms createdAt is LARGER', () => {
    // User's optimistic row: created at 1000.400 ms (sub-second), adopted id 8501.
    // Agent reply: Telegram date 1000 → createdAt 1000_000 (truncated .000), id 8502.
    // Sorting by createdAt would put the agent (1000_000) above the user (1000_400).
    const question = localMsg('c-q', 'user', 1_000_400, '8501', '전등 갈아줘');
    const answer = msg('8502', 'agent', 1_000_000, '어떤 전등인가요?');
    expect(sortConversationChronology([answer, question]).map((m) => m.id)).toEqual(['8501', '8502']);
  });

  it('orders by server sequence under phone↔server clock skew (createdAt out of order)', () => {
    // Phone clock runs ahead: the user row's createdAt (2_000_000) lands LATER than
    // the agent reply it preceded (1_000_000), but the ids reflect true order.
    const question = localMsg('c-q', 'user', 2_000_000, '8501');
    const answer = msg('8502', 'agent', 1_000_000);
    expect(sortConversationChronology([answer, question]).map((m) => m.id)).toEqual(['8501', '8502']);
  });

  it('places a not-yet-confirmed local row chronologically, then snaps it into place once it has a server id', () => {
    const older = msg('8500', 'agent', 900_000);
    const later = msg('8502', 'agent', 1_100_000);
    // Pending (id null) row is placed by its createdAt (1_000_000) BETWEEN the two
    // confirmed rows — not stranded at the tail.
    const pending = localMsg('c-q', 'user', 1_000_000, null);
    expect(sortConversationChronology([older, later, pending]).map((m) => m.clientMessageId))
      .toEqual(['8500', 'c-q', '8502']);
    // Once the send is confirmed with id 8501, it snaps between 8500 and 8502.
    const confirmed = { ...pending, id: '8501', status: 'sent' as const };
    expect(sortConversationChronology([older, later, confirmed]).map((m) => m.id))
      .toEqual(['8500', '8501', '8502']);
  });

  it('keeps a FRESH optimistic send at the tail (its createdAt is the newest)', () => {
    const older1 = msg('8760', 'agent', 5_000_000);
    const older2 = msg('8763', 'agent', 6_000_000);
    const fresh = localMsg('fresh', 'user', 7_000_000, null); // just typed → newest
    expect(sortConversationChronology([older1, fresh, older2]).map((m) => m.clientMessageId))
      .toEqual(['8760', '8763', 'fresh']);
  });

  // Regression for the real report: a send that failed client-side two days ago
  // (id null) actually reached Telegram, but the local row stayed un-acked. It
  // must NOT float to the bottom as if it were the newest message.
  it('does not strand a stale un-acked local send at the tail', () => {
    const stale = localMsg('stale-kbo', 'user', 1_000_000, null); // old createdAt
    const today1 = msg('8760', 'agent', 5_000_000);
    const today2 = msg('8763', 'agent', 6_000_000);
    expect(sortConversationChronology([today1, today2, stale]).map((m) => m.clientMessageId))
      .toEqual(['stale-kbo', '8760', '8763']);
  });

  it('places a pending question before a same-second confirmed reply', () => {
    const q = localMsg('q', 'user', 1_000_400, null); // pending, sub-second
    const reply = msg('8502', 'agent', 1_000_000); // confirmed reply, same second
    expect(sortConversationChronology([reply, q]).map((m) => m.clientMessageId))
      .toEqual(['q', '8502']);
  });

  it('orders multiple pending rows among themselves by createdAt (offline queue)', () => {
    const q1 = localMsg('q1', 'user', 1_000, null);
    const q2 = localMsg('q2', 'user', 2_000, null);
    const q3 = localMsg('q3', 'user', 3_000, null);
    expect(sortConversationChronology([q3, q1, q2]).map((m) => m.clientMessageId))
      .toEqual(['q1', 'q2', 'q3']);
  });
});

describe('selectVisibleMessages', () => {
  it('returns a chronologically ordered, tie-broken view', () => {
    const question = msg('8471', 'user', 1783232919000);
    const answer = msg('8472', 'agent', 1783232919000);
    const older = msg('8470', 'agent', 1783232899000);
    expect(selectVisibleMessages([answer, older, question]).map((m) => m.id)).toEqual(['8470', '8471', '8472']);
  });
});
