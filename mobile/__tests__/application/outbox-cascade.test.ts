/**
 * Outbox round-trip: SQLite FK + status cascade.
 *
 * Use-case 단위 테스트는 chat-usecases.test.ts 에서 다루며, 여기에서는 outbox 가
 * messages.id FK 와 협력하는 cascade 시나리오 (delete / FK 위반 방지 reorder) 를
 * 빠르게 박제한다 — repository 레벨 회귀 방지용.
 */
import { createBetterSqlite3Database } from '@/infrastructure/storage/adapters/better-sqlite3-adapter';
import { applyMigrations } from '@/infrastructure/storage/database';
import { BuddiesRepository } from '@/infrastructure/storage/repositories/buddies-repo';
import { MessagesRepository } from '@/infrastructure/storage/repositories/messages-repo';
import { OutboxRepository } from '@/infrastructure/storage/repositories/outbox-repo';

function seed() {
  const db = createBetterSqlite3Database();
  applyMigrations(db);
  const buddies = new BuddiesRepository(db);
  buddies.upsert({
    id: 'b1',
    username: 'echo_bot',
    displayName: 'Echo',
    iconUrl: null,
    traceSupported: false,
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: 1,
  });
  const messages = new MessagesRepository(db);
  messages.insert({
    id: null,
    clientMessageId: 'cm-1',
    buddyId: 'b1',
    role: 'user',
    text: 'hello',
    status: 'sending',
    createdAt: 2,
    traceId: null,
  });
  const outbox = new OutboxRepository(db);
  outbox.enqueue({
    messageId: 'cm-1',
    buddyId: 'b1',
    text: 'hello',
    retryCount: 0,
    lastError: null,
    enqueuedAt: 3,
  });
  return { db, buddies, messages, outbox };
}

describe('Outbox / messages FK cascade', () => {
  it('updateServerId without removing outbox first is rejected by FK', () => {
    const { db, messages } = seed();
    expect(() => {
      messages.updateServerId('cm-1', '77');
    }).toThrow(/FOREIGN KEY|SQLITE_CONSTRAINT/);
    db.close();
  });

  it('remove(outbox) → updateServerId → updateStatus succeeds inside a transaction', () => {
    const { db, messages, outbox } = seed();
    db.transaction(() => {
      outbox.remove('cm-1');
      messages.updateServerId('cm-1', '77');
      messages.updateStatus('cm-1', 'sent');
    });
    expect(messages.findByClientMessageId('cm-1')?.id).toBe('77');
    expect(messages.findByClientMessageId('cm-1')?.status).toBe('sent');
    expect(outbox.count()).toBe(0);
    db.close();
  });

  it('FIFO ordering by enqueuedAt', () => {
    const { db, messages, outbox } = seed();
    messages.insert({
      id: null,
      clientMessageId: 'cm-2',
      buddyId: 'b1',
      role: 'user',
      text: 'second',
      status: 'queued',
      createdAt: 4,
      traceId: null,
    });
    outbox.enqueue({
      messageId: 'cm-2',
      buddyId: 'b1',
      text: 'second',
      retryCount: 0,
      lastError: null,
      enqueuedAt: 5,
    });
    const order = outbox.listOldestFirst().map((e) => e.messageId);
    expect(order).toEqual(['cm-1', 'cm-2']);
    db.close();
  });
});
