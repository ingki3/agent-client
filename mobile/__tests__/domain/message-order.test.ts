import { selectVisibleMessages, sortConversationChronology } from '@/domain/messages/duplicateMessages';
import type { Message } from '@/domain/entities/Message';

function msg(id: string, role: Message['role'], createdAt: number, text = id): Message {
  return { id, clientMessageId: id, buddyId: 'b1', role, text, status: 'sent', createdAt, traceId: null };
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
});

describe('selectVisibleMessages', () => {
  it('returns a chronologically ordered, tie-broken view', () => {
    const question = msg('8471', 'user', 1783232919000);
    const answer = msg('8472', 'agent', 1783232919000);
    const older = msg('8470', 'agent', 1783232899000);
    expect(selectVisibleMessages([answer, older, question]).map((m) => m.id)).toEqual(['8470', '8471', '8472']);
  });
});
