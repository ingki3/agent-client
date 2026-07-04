import { useBuddiesStore } from '@/application/stores/buddies-store';
import { useChatStore } from '@/application/stores/chat-store';
import { useNetworkStore } from '@/application/stores/network-store';
import { useTraceStore } from '@/application/stores/trace-store';
import { useUIStore } from '@/application/stores/ui-store';
import type { Buddy } from '@/domain/entities/Buddy';
import type { Message } from '@/domain/entities/Message';

function makeBuddy(id: string, overrides: Partial<Buddy> = {}): Buddy {
  return {
    id,
    username: `bot_${id}`,
    displayName: `Buddy ${id}`,
    iconUrl: null,
    traceSupported: false,
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeMessage(clientId: string, buddyId = 'b1'): Message {
  return {
    id: null,
    clientMessageId: clientId,
    buddyId,
    role: 'user',
    text: 'hi',
    status: 'sending',
    createdAt: 0,
    traceId: null,
  };
}

beforeEach(() => {
  useBuddiesStore.getState().reset();
  useChatStore.getState().reset();
  useTraceStore.getState().reset();
  useNetworkStore.setState({ isOnline: true, pendingOutboxCount: 0, lastTransitionAt: null });
  useUIStore.setState({ toasts: [], pendingRouteIntent: null });
});

describe('useBuddiesStore', () => {
  it('upserts and removes preserving order', () => {
    const s = useBuddiesStore.getState();
    s.upsert(makeBuddy('a'));
    s.upsert(makeBuddy('b'));
    expect(useBuddiesStore.getState().order).toEqual(['a', 'b']);
    s.upsert(makeBuddy('a', { displayName: 'A!' }));
    expect(useBuddiesStore.getState().order).toEqual(['a', 'b']);
    expect(useBuddiesStore.getState().buddies.a?.displayName).toBe('A!');
    s.remove('a');
    expect(useBuddiesStore.getState().order).toEqual(['b']);
  });

  it('caches getMe per token', () => {
    const s = useBuddiesStore.getState();
    s.cacheGetMe('tok-1', { id: '1', isBot: true, firstName: 'X', username: null });
    expect(useBuddiesStore.getState().getCachedMe('tok-1')?.firstName).toBe('X');
    expect(useBuddiesStore.getState().getCachedMe('tok-2')).toBeUndefined();
  });
});

describe('useChatStore', () => {
  it('appendMessage and setStatus, setServerId, appendDelta', () => {
    const s = useChatStore.getState();
    s.appendMessage(makeMessage('cm-1'));
    s.setStatus('cm-1', 'sent');
    s.setServerId('cm-1', 'srv-100');
    s.appendDelta('cm-1', ' world');

    const state = useChatStore.getState();
    expect(state.byBuddy.b1).toEqual(['cm-1']);
    expect(state.messages['cm-1']?.id).toBe('srv-100');
    expect(state.messages['cm-1']?.status).toBe('sent');
    expect(state.messages['cm-1']?.text).toBe('hi world');
  });

  it('appendMessage is idempotent on the same clientMessageId', () => {
    const s = useChatStore.getState();
    s.appendMessage(makeMessage('cm-1'));
    s.appendMessage({ ...makeMessage('cm-1'), text: 'updated' });
    const state = useChatStore.getState();
    expect(state.byBuddy.b1).toEqual(['cm-1']);
    expect(state.messages['cm-1']?.text).toBe('updated');
  });

  it('appendMessage hides likely duplicate relay messages with different ids', () => {
    const s = useChatStore.getState();
    s.appendMessage({
      ...makeMessage('6483'),
      id: '6483',
      role: 'agent',
      text: 'same answer',
      status: 'sent',
      createdAt: 1780907571000,
    });
    s.appendMessage({
      ...makeMessage('6484'),
      id: '6484',
      role: 'agent',
      text: 'same answer',
      status: 'sent',
      createdAt: 1780907574000,
    });

    const state = useChatStore.getState();
    expect(state.byBuddy.b1).toEqual(['6483']);
    expect(state.messages['6484']).toBeUndefined();
  });

  it('keeps identical agent messages with distinct ids more than 5s apart', () => {
    const s = useChatStore.getState();
    s.appendMessage({
      ...makeMessage('7001'),
      id: '7001',
      role: 'agent',
      text: 'same answer',
      status: 'sent',
      createdAt: 1780907571000,
    });
    s.appendMessage({
      ...makeMessage('7002'),
      id: '7002',
      role: 'agent',
      text: 'same answer',
      status: 'sent',
      createdAt: 1780907601000,
    });

    const state = useChatStore.getState();
    expect(state.byBuddy.b1).toEqual(['7001', '7002']);
  });

  it('does not keep hidden helper submit context messages', () => {
    const s = useChatStore.getState();
    const hidden = {
      ...makeMessage('cm-hidden'),
      text: '사용자가 아래 후속 액션을 선택했습니다.\n\n```agent_helper_response\n{"helperItemId":"x","value":"상세히 설명해줘"}\n```',
    };
    s.appendMessage(hidden);
    expect(useChatStore.getState().byBuddy.b1).toBeUndefined();

    s.setBuddyMessages('b1', [hidden, makeMessage('cm-visible')]);
    const state = useChatStore.getState();
    expect(state.byBuddy.b1).toEqual(['cm-visible']);
    expect(state.messages['cm-hidden']).toBeUndefined();
  });
});

describe('useTraceStore', () => {
  it('appendNode preserves order per message', () => {
    const s = useTraceStore.getState();
    s.appendNode('m1', { kind: 'thinking', seq: 0, startedAt: 0, step: 'plan', summary: 's' });
    s.appendNode('m1', {
      kind: 'tool_call',
      seq: 1,
      startedAt: 0,
      id: 't',
      name: 'search',
      args: {},
    });
    expect(useTraceStore.getState().byMessage.m1).toHaveLength(2);
  });
});

describe('useNetworkStore', () => {
  it('updates lastTransitionAt only on change', () => {
    const before = useNetworkStore.getState().lastTransitionAt;
    useNetworkStore.getState().setOnline(true);
    expect(useNetworkStore.getState().lastTransitionAt).toBe(before);
    useNetworkStore.getState().setOnline(false);
    expect(useNetworkStore.getState().isOnline).toBe(false);
    expect(useNetworkStore.getState().lastTransitionAt).not.toBe(before);
  });
});

describe('useUIStore', () => {
  it('push and dismiss toast', () => {
    const id = useUIStore.getState().pushToast({ message: 'hi', level: 'info' });
    expect(useUIStore.getState().toasts).toHaveLength(1);
    useUIStore.getState().dismissToast(id);
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});
