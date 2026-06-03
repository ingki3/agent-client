/**
 * Mock fixtures for the usability-test build (BIZ-230).
 * No backend wiring — these are in-memory only.
 */

export type AccentSlot =
  | 'accent-buddy-1'
  | 'accent-buddy-2'
  | 'accent-buddy-3'
  | 'accent-buddy-4'
  | 'accent-buddy-5'
  | 'accent-buddy-6'
  | 'accent-buddy-7'
  | 'accent-buddy-8';

export type Buddy = {
  id: string;
  displayName: string;
  handle: string;
  accent: AccentSlot;
  role: 'work' | 'personal' | 'research';
  description: string;
  connected: boolean;
  unread: number;
  lastMessagePreview: string;
  lastMessageAt: string; // ISO
};

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'queued-offline';

export type Message = {
  id: string;
  buddyId: string;
  author: 'user' | 'agent' | 'system';
  text: string;
  createdAt: string; // ISO
  status?: MessageStatus;
  // For UC-11 (Trace) and inline cards in future passes — keep optional.
  traceSummary?: { thinkingSteps: number; toolCalls: number; elapsedMs: number };
};

export const buddies: Buddy[] = [
  {
    id: 'buddy-work',
    displayName: 'Work Buddy',
    handle: '@simpleclaw_work_bot',
    accent: 'accent-buddy-1',
    role: 'work',
    description: '사내 이메일·캘린더·이슈 트래커 연동',
    connected: true,
    unread: 2,
    lastMessagePreview: '오늘 일정 3건, 답장이 필요한 이메일 2건이 있어요.',
    lastMessageAt: '2026-05-17T08:12:00+09:00',
  },
  {
    id: 'buddy-life',
    displayName: 'Life Buddy',
    handle: '@openclaw_life_bot',
    accent: 'accent-buddy-2',
    role: 'personal',
    description: 'Gmail · 쇼핑 · 여행 · 메모',
    connected: true,
    unread: 0,
    lastMessagePreview: '이번 주말 부산 여행 일정 초안을 캘린더에 추가했어요.',
    lastMessageAt: '2026-05-16T22:45:00+09:00',
  },
  {
    id: 'buddy-knowledge',
    displayName: 'Knowledge Keeper',
    handle: '@openclaw_knowledge_bot',
    accent: 'accent-buddy-6',
    role: 'research',
    description: '링크/문서 요약 · 시맨틱 검색',
    connected: false,
    unread: 1,
    lastMessagePreview: '토큰이 만료되었습니다. 다시 연결해 주세요.',
    lastMessageAt: '2026-05-15T19:03:00+09:00',
  },
];

export const messagesByBuddy: Record<string, Message[]> = {
  'buddy-work': [
    {
      id: 'm1',
      buddyId: 'buddy-work',
      author: 'agent',
      text: '좋은 아침이에요. 오늘 일정 3건, 답장이 필요한 이메일 2건이 있어요.',
      createdAt: '2026-05-17T08:10:00+09:00',
    },
    {
      id: 'm2',
      buddyId: 'buddy-work',
      author: 'user',
      text: '메일 먼저 요약해줘.',
      createdAt: '2026-05-17T08:11:00+09:00',
      status: 'delivered',
    },
    {
      id: 'm3',
      buddyId: 'buddy-work',
      author: 'agent',
      text: '두 건 모두 외부 협력사 회신이에요. 첫 메일은 견적 확인, 두 번째는 미팅 일정 조율 요청.',
      createdAt: '2026-05-17T08:11:30+09:00',
      traceSummary: { thinkingSteps: 2, toolCalls: 3, elapsedMs: 1820 },
    },
    {
      id: 'm4',
      buddyId: 'buddy-work',
      author: 'user',
      text: '두 번째 메일 답장 초안 부탁',
      createdAt: '2026-05-17T08:12:00+09:00',
      status: 'sent',
    },
  ],
  'buddy-life': [
    {
      id: 'l1',
      buddyId: 'buddy-life',
      author: 'user',
      text: '다음 주 토요일 부산 1박 2일, 바다 보이는 숙소로 계획 짜줘. 2명 25만원까지.',
      createdAt: '2026-05-16T22:30:00+09:00',
      status: 'delivered',
    },
    {
      id: 'l2',
      buddyId: 'buddy-life',
      author: 'agent',
      text: '해운대 권역으로 초안을 잡았어요. 숙소 3곳, 식당 3곳을 추렸고 첫 일정 카드를 캘린더에 등록했어요.',
      createdAt: '2026-05-16T22:45:00+09:00',
      traceSummary: { thinkingSteps: 3, toolCalls: 5, elapsedMs: 4210 },
    },
  ],
  'buddy-knowledge': [
    {
      id: 'k1',
      buddyId: 'buddy-knowledge',
      author: 'system',
      text: 'Knowledge Keeper의 OAuth 토큰이 만료되었습니다.',
      createdAt: '2026-05-15T19:03:00+09:00',
    },
  ],
};
