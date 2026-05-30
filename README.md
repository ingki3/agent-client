# Agent Client

> 에이전트(봇)와의 연결을 위한 전용 메신저 — **Telegram Bot API 호환** 모바일 앱 + 백그라운드 푸시 relay.

일반 메신저(Telegram 등)는 사람 간 대화 중심이라 에이전트(LLM 봇)와의 대화, 특히 마크다운
렌더링·추론 과정(trace) 확인에 최적화돼 있지 않다. Agent Client는 친구를 추가하듯 봇을
**버디(Buddy)** 로 등록하고, GFM 마크다운 풀-렌더링 + thinking/tool-call trace + 응답
스트리밍을 갖춘 채팅 UX로 대화한다.

`mobile/` 의 RN(Expo) 앱과 `relay/` 의 푸시 relay 서버, 두 부분으로 구성된다.

---

## 무엇이 구현되어 있나

### 📱 모바일 앱 (`mobile/`)
Expo SDK 51 · Expo Router · Zustand · TypeScript(strict). iOS / Android / web 단일 코드베이스.

- **온보딩 (단일 사용자)** — 로그인/OTP 없이, 첫 실행 시 텔레그램 **user id(= chat_id)** 를
  한 번 입력. 이 id가 버디의 기본 전송 주소가 되어 "봇에게 먼저 말 걸기" 없이 즉시 전송 가능.
  SecureStore에 저장되어 자동 진입.
- **버디 추가** — 봇 토큰 입력 → 실제 `getMe` 로 검증 + 미리보기 → 확정. 봇 id로 중복 방지,
  토큰은 SecureStore(iOS Keychain / Android EncryptedSharedPreferences)에만 저장.
- **친구 리스트** — 표시명·아이콘·마지막 메시지·미확인 카운트. FAB로 추가, 길게 눌러 삭제.
- **채팅** — 텍스트 송수신, 메시지 상태(전송 중/전송됨/응답 중/완료/실패), 실패 시 재전송.
  - **스트리밍 렌더링** — 응답이 점진적으로 채워지는 타자 효과, 중단(Stop) 제어.
  - **GFM 마크다운 풀-렌더링** — 의존성 없는 자체 AST 파서: 헤더, bold/italic/strike,
    인라인·펜스 코드, 정렬·중첩 리스트, 체크박스, 표, 인용, 링크, 수평선. 스트리밍 중
    미완성 토큰(`**`, ``` ``` ```)은 안전하게 점진 적용.
  - **Trace 가시화** — 응답 하단 "🧠 N단계 · 🛠 M개 툴 · ⏱ t초" 요약 → 펼치면
    thinking / tool_call / tool_result 노드, 탭하면 원본 JSON(민감값 마스킹). trace 없는
    표준 봇은 패널 미노출(fallback).
- **설정** — user id 표시, 알림 토글, 정보/라이선스, 초기화(모든 토큰·캐시 삭제).
- **다크 모드** 자동 대응. `.pen` 디자인 토큰과 1:1 매핑된 테마.

### 🔔 푸시 relay (`relay/`)
gateway를 수정하지 않고 **백그라운드 푸시**(앱이 꺼져 있어도 알림)를 가능하게 하는,
직접 소유하는 최소 서버. Node/TS · Fastify · better-sqlite3 · Expo Push.

- 봇당 **단일 `getUpdates` 소비자**가 되어(텔레그램 단일소비자 제약 회피) 메시지를 버퍼링하고
  **Expo Push**로 기기에 발송(APNs/FCM 인증서 직접 관리 불필요).
- 앱은 relay 활성 시 텔레그램을 직접 폴링하지 않고 relay `/pull`로 수신. 전송(sendMessage)은
  그대로 gateway 직결.
- 봇 토큰 **AES-256-GCM 암호화 보관**, 로그 마스킹, 기기별 secret 인증, 구독 해제 시 토큰 삭제.

---

## Telegram 프로토콜

모든 Bot API 호출은 `{gateway}/bot{token}/{method}` (텔레그램 표준):
`getMe`, `sendMessage`, `editMessageText`, `getUpdates`(long-poll), `sendChatAction`.

- **기본 gateway** = `https://api.telegram.org` → **실제 텔레그램 봇과 즉시 대화** 가능.
- **커스텀 게이트웨이(Hermes/agent 등)** — `app.json`의 `expo.extra.gateway`로 교체.
  봇 토큰을 입력하는 동일 프로토콜이면 그대로 동작. `expo.extra.apiBase`로 확장(인증 API +
  SSE trace/delta 스트림)을 더할 수 있고, `expo.extra.relayBase`로 푸시 relay를 연결한다.

mock seed 버디(토큰 없음)는 백엔드 없이도 스트리밍·마크다운·trace를 시연한다.

---

## 빠르게 실행

```bash
# 앱 (개발 모드)
cd mobile && npm install && npm run ios     # 또는 npm run android / npm run web

# 앱 (standalone Release — Metro 없이 단독 실행)
cd mobile && npx expo run:ios --configuration Release

# 푸시 relay (선택)
cd relay && npm install
RELAY_MASTER_KEY=$(openssl rand -hex 32) npm start
```

첫 실행 시 텔레그램 user id 입력 → 친구 리스트 → FAB(+)로 봇 토큰 추가 → 채팅.

자세한 사용/설정은 [mobile/README.md](./mobile/README.md), [relay/README.md](./relay/README.md) 참고.

---

## 검증 상태

| 항목 | 결과 |
|------|------|
| `tsc --noEmit` (app + relay) | clean |
| 도메인 단위 (마크다운 파서·스트리밍 토큰 억제·민감값 마스킹·상태 전이) | 13/13 |
| relay 단위 (암호화 왕복·/pull 커서 멱등·봇 reap) | 10/10 |
| 라이브 Telegram (`getMe`·`sendMessage`·`editMessageText`·`getUpdates`) | 실제 봇으로 통과 |
| Maestro E2E (온보딩·채팅·마크다운·trace·삭제·초기화) | 4/4 (standalone Release) |
| Maestro E2E 라이브 (봇 토큰 추가·양방향) | `-e BOT_TOKEN=…` 로 통과 |
| relay-pull 수신 (앱이 relay 버퍼에서 메시지 수신·렌더) | 시뮬에서 통과 |

실기기 백그라운드 **푸시 도달**은 OS 제약상 EAS dev/standalone 빌드 + 실기기 필요(시뮬 불가).

---

## 구조

```
AgentClient/
├── README.md             # (이 문서)
├── PRD.md                # 제품 요구사항 (MVP 범위)
├── TECH_SPEC.md          # 기술 명세
├── USER_FLOW.md          # 화면 단위 설계 (ID 기반)
├── AgentClient_MVP.pen   # Pencil 와이어프레임 (light + dark)
│
├── mobile/               # React Native (Expo) 앱
│   ├── app/              #   Expo Router 화면 (라우트 = 파일)
│   │   ├── index.tsx               # 스플래시 → 분기
│   │   ├── (auth)/userid.tsx       # 온보딩: user id 입력
│   │   └── (main)/                 # buddies · chat/[id] · add-buddy · settings
│   ├── src/
│   │   ├── domain/       #     순수 TS: entities, markdown 파서 (RN import 없음)
│   │   ├── application/  #     Zustand stores (auth/buddies/chat/trace/notifications) + usecases
│   │   ├── infrastructure/ #   telegramBotApi · authless session · relayClient · traceStream
│   │   │                   #   · pushClient · ReceiveSource · secureStore · kv(sqlite/web)
│   │   └── ui/           #     markdown 렌더러, TracePanel
│   ├── e2e/              #   Maestro 플로우
│   └── scripts/          #   smoke-domain.ts · smoke-telegram.mjs
│
└── relay/                # 푸시 relay 서버 (Node/TS)
    └── src/              #   index(API) · poller(getUpdates 루프) · push(Expo) · store(sqlite) · crypto
```

### 아키텍처 (레이어드 클린 아키텍처, TECH_SPEC §2)
```
app/ ─► src/ui ─► src/application ─► src/domain
                ─► src/infrastructure ──┘  (adapter implements port)
```
`src/domain` 은 외부 의존 없음. 수신은 `ReceiveSource` 포트로 추상화 —
relay 미설정 시 텔레그램 직접 폴링(`TelegramPollSource`), 설정 시 relay pull(`RelayPullSource`).
두 경로 모두 `useChatStore.ingestUpdates` 단일 dedupe/offset authority로 수렴.
```
