/**
 * Seed data for buddies that are NOT backed by a real bot token ("mock" buddies).
 * These power the usability-test build and demonstrate streaming + markdown + trace
 * without a backend. Real buddies (added via a token) use the live Telegram path.
 */
import type { Buddy, Message } from "@/domain/entities";
import type { StreamEvent } from "@/infrastructure/api/traceStream";

export const seedBuddies: Buddy[] = [
  {
    id: "buddy-work",
    displayName: "Work Buddy",
    handle: "@simpleclaw_work_bot",
    botId: null,
    chatId: "mock-work",
    live: false,
    supportsTrace: true,
    accent: "accent-buddy-1",
    description: "사내 이메일·캘린더·이슈 트래커 연동",
    connected: true,
    unread: 2,
    lastMessagePreview: "오늘 일정 3건, 답장이 필요한 이메일 2건이 있어요.",
    lastMessageAt: "2026-05-17T08:12:00+09:00",
  },
  {
    id: "buddy-life",
    displayName: "Life Buddy",
    handle: "@openclaw_life_bot",
    botId: null,
    chatId: "mock-life",
    live: false,
    supportsTrace: true,
    accent: "accent-buddy-2",
    description: "Gmail · 쇼핑 · 여행 · 메모",
    connected: true,
    unread: 0,
    lastMessagePreview: "이번 주말 부산 여행 일정 초안을 캘린더에 추가했어요.",
    lastMessageAt: "2026-05-16T22:45:00+09:00",
  },
  {
    id: "buddy-knowledge",
    displayName: "Knowledge Keeper",
    handle: "@openclaw_knowledge_bot",
    botId: null,
    chatId: "mock-knowledge",
    live: false,
    supportsTrace: false, // standard bot — trace panel hidden (fallback)
    accent: "accent-buddy-6",
    description: "링크/문서 요약 · 시맨틱 검색",
    connected: false,
    unread: 1,
    lastMessagePreview: "토큰이 만료되었습니다. 다시 연결해 주세요.",
    lastMessageAt: "2026-05-15T19:03:00+09:00",
  },
];

function msg(p: Omit<Message, "clientId">): Message {
  return { clientId: p.id, ...p };
}

export const seedMessages: Record<string, Message[]> = {
  "buddy-work": [
    msg({
      id: "m1",
      buddyId: "buddy-work",
      role: "agent",
      status: "done",
      text: "좋은 아침이에요. 오늘 **일정 3건**, 답장이 필요한 이메일 2건이 있어요.",
      createdAt: "2026-05-17T08:10:00+09:00",
    }),
    msg({
      id: "m2",
      buddyId: "buddy-work",
      role: "user",
      text: "메일 먼저 요약해줘.",
      createdAt: "2026-05-17T08:11:00+09:00",
      status: "done",
    }),
    msg({
      id: "m3",
      buddyId: "buddy-work",
      role: "agent",
      status: "done",
      text: "두 건 모두 외부 협력사 회신이에요.\n\n| 메일 | 요지 | 우선순위 |\n|---|---|:--:|\n| 견적 확인 | 단가 재협상 | 높음 |\n| 미팅 조율 | 다음 주 화/목 | 보통 |",
      createdAt: "2026-05-17T08:11:30+09:00",
      traceSummary: { thinkingSteps: 2, toolCalls: 3, elapsedMs: 1820 },
      traceId: "trace-m3",
    }),
  ],
  "buddy-life": [
    msg({
      id: "l1",
      buddyId: "buddy-life",
      role: "user",
      text: "다음 주 토요일 부산 1박 2일, 바다 보이는 숙소로 계획 짜줘. 2명 25만원까지.",
      createdAt: "2026-05-16T22:30:00+09:00",
      status: "done",
    }),
    msg({
      id: "l2",
      buddyId: "buddy-life",
      role: "agent",
      status: "done",
      text: "해운대 권역으로 초안을 잡았어요.\n\n- [x] 숙소 3곳 추림\n- [x] 식당 3곳 추림\n- [ ] 캘린더 등록 확정 대기",
      createdAt: "2026-05-16T22:45:00+09:00",
      traceSummary: { thinkingSteps: 3, toolCalls: 5, elapsedMs: 4210 },
      traceId: "trace-l2",
    }),
  ],
  "buddy-knowledge": [
    msg({
      id: "k1",
      buddyId: "buddy-knowledge",
      role: "system",
      text: "Knowledge Keeper의 OAuth 토큰이 만료되었습니다.",
      createdAt: "2026-05-15T19:03:00+09:00",
      status: "done",
    }),
  ],
};

/** A rich GFM reply to showcase the full-spec renderer (FR-15). */
const RICH_REPLY = `요청하신 내용을 정리했어요.

## 핵심 요약
1. **우선순위**가 높은 항목부터 처리했습니다.
2. 관련 코드와 표를 함께 첨부합니다.

\`\`\`ts
function greet(name: string) {
  return \`안녕하세요, \${name}님\`;
}
\`\`\`

| 단계 | 상태 |
|---|:--:|
| 분석 | ✅ |
| 실행 | ✅ |

> 추가로 필요한 게 있으면 알려주세요.`;

const SHORT_REPLIES = [
  "확인했어요. 바로 처리할게요. ✅",
  "방금 확인했어요. 추가로 필요한 부분이 있으면 알려주세요.",
  "관련 정보를 정리하는 중이에요. 곧 자세히 답변드릴게요.",
];

/** Pick a canned reply for a mock buddy. Long messages get the rich-markdown reply. */
export function cannedReply(userText: string): string {
  if (userText.trim().length > 14) return RICH_REPLY;
  const idx = Math.floor(Math.random() * SHORT_REPLIES.length);
  return SHORT_REPLIES[idx]!;
}

/** Synthetic trace emitted alongside a mock reply (for trace-supporting buddies). */
export function syntheticTrace(): Array<
  Extract<StreamEvent, { type: "thinking" | "tool_call" | "tool_result" }>
> {
  return [
    { type: "thinking", step: 1, summary: "요청 의도 분석", content: "사용자의 요청을 분해하고 필요한 도구를 결정합니다." },
    {
      type: "tool_call",
      id: "tc1",
      name: "search_context",
      args: { query: "최근 관련 항목", limit: 5, api_key: "sk-secret-should-be-masked" },
      startedAt: 0,
    },
    { type: "tool_result", id: "tc1", status: "ok", preview: "5건의 관련 항목을 찾았습니다.", latencyMs: 612 },
    { type: "thinking", step: 2, summary: "응답 구성", content: "검색 결과를 바탕으로 마크다운 응답을 작성합니다." },
  ];
}
