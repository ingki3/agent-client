# Agent Client — PRD (Simplified)

## 1. Vision & Problem

### 1.1 Vision
Agent Client는 **에이전트와의 연결을 위한 전용 메신저**다. 사용자는 메신저의 친구를 추가하듯 에이전트(봇)를 "친구(Buddy)"로 등록하고, 익숙한 채팅 UX로 대화한다.

### 1.2 Problem
- 일반 메신저(Telegram 등)는 사람 간 메시징 중심이라 에이전트 대화에 최적화돼 있지 않다. 특히 LLM이 생성하는 마크다운(헤더·표·코드·중첩 리스트)을 제대로 렌더링하지 않아 모바일 가독성이 떨어진다.
- 여러 에이전트를 한 곳에서 관리할 수단이 없다.
- 모바일에서 즉시 에이전트에게 말 걸고, 에이전트의 추론·도구 호출 과정까지 확인할 수 있는 전용 앱이 필요하다.

### 1.3 Scope of this PRD
이 문서는 **MVP 범위**만 다룬다. 음성 입출력, OAuth 카드, 공유 시트, 자연어 검색 등 고급 기능은 후속 PRD에서 정의한다. 에이전트 신뢰성의 핵심인 **thinking/tool-call trace 가시화**는 MVP에 포함한다.

### 1.4 Foundation
- **모든 기반 규칙은 Telegram을 기준으로 한다.** 사용자 인증, 버디(봇) 관리, 채팅 프로토콜은 Telegram의 모델을 그대로 따른다.
  - 사용자 인증: 전화번호 + SMS 코드(텔레그램 표준 흐름).
  - 버디 관리: 봇 단위로 등록·삭제, `getMe`로 메타 조회, 봇 토큰을 자격증명으로 사용.
  - 채팅 프로토콜: Telegram Bot API 메서드(`getMe`, `sendMessage`, `editMessageText`, `getUpdates`/`setWebhook`, `sendChatAction`).
- **Telegram 표준으로 표현 불가한 영역에 한해서만 명시적 확장**을 둔다 — GFM 마크다운 렌더링, 응답 텍스트 스트리밍(`message_delta`), thinking·tool-call trace 이벤트.
- 표준 Telegram 봇(확장 미지원)도 본문은 정상 동작해야 한다(자동 fallback).

## 2. Target User

- 단일 사용자(개인용). 가족 공유·다중 사용자 모델은 제외.
- 모바일에서 채팅 형식으로 에이전트를 사용하고 싶은 일반 사용자.

## 3. Core Use Cases

| ID | 한 줄 설명 | 우선순위 |
|----|-----------|---------|
| UC-01 | 앱 최초 실행 시 로그인 (및 로그아웃) | P0 |
| UC-02 | 봇 토큰으로 친구(에이전트) 추가 | P0 |
| UC-03 | 등록된 친구 목록 보기 / 친구 선택 | P0 |
| UC-04 | 선택한 친구와 텍스트로 채팅 | P0 |
| UC-05 | 에이전트 응답의 thinking·tool call 과정 확인 | P0 |

### UC-01: 로그인 / 로그아웃 (Telegram 표준 흐름)
- 트리거(로그인): 신규 설치 후 앱 첫 진입, 또는 로그아웃 상태 진입.
- 흐름(로그인): 국가 코드 선택 → 전화번호 입력 → [다음] → SMS 인증 코드 수신 → 코드 입력 → 인증 성공 → 친구 리스트 진입. 이후 자동 로그인.
- 트리거(로그아웃): 설정 화면의 [로그아웃] 탭.
- 흐름(로그아웃): 확인 다이얼로그 → 인증 토큰·봇 토큰·로컬 캐시 삭제 → 로그인 화면 복귀.
- 성공 조건: 인증 토큰이 SecureStore에 안전하게 저장되고, 앱 재실행 시 자동 로그인되어 친구 리스트로 진입.
- 대안: 코드 미수신 시 [재전송] / [음성 통화로 받기], 만료/오답/네트워크 오류 사유 표시 및 재시도 동선 제공.

### UC-02: 친구 추가 (봇 토큰)
- 트리거: 친구 리스트 화면의 [+] 버튼 탭.
- 흐름: 봇 토큰 입력 → `getMe` 호출로 봇 정보(이름·아이콘) 미리보기 → [추가] 확정 → 친구 리스트에 등록. 등록 직후 `/start` 자동 전송.
- 성공 조건: 신규 친구가 리스트에 표시되고 채팅 진입 가능.
- 대안: 토큰 오류 시 사유 표시, 중복 등록 방지 안내.

### UC-03: 친구 리스트
- 트리거: 로그인 직후, 또는 채팅에서 뒤로 가기.
- 흐름: 등록된 친구를 리스트로 표시. 표시명·아이콘·마지막 메시지·시각·미확인 카운트 노출.
- 성공 조건: 친구 탭 시 해당 채팅 화면으로 즉시 진입.
- 빈 상태: 친구가 없을 때 [+ 봇 추가] CTA 노출.

### UC-04: 채팅
- 트리거: 친구 리스트에서 친구 탭.
- 흐름: 채팅 화면 진입 → 텍스트 입력·전송 → 에이전트 응답이 **스트리밍**으로 점진적으로 화면에 채워짐(타자 효과) → 완료 시 최종 마크다운 서식 적용 → 스크롤로 과거 대화 조회.
- 성공 조건: 양방향 메시지 송수신, 스트리밍 렌더링, 메시지 상태(전송 중/전송됨/응답 중/완료/실패) 표시, 마크다운 풀-스펙 서식 렌더링.

### UC-05: thinking·tool call 과정 확인
- 트리거: 에이전트 응답 메시지 하단의 접힌 trace 패널(예: "🧠 3단계로 사고함 · 🛠 5개 툴 호출") 탭.
- 흐름: 패널 펼침 → 단계별 노드 렌더링
  - **Thinking 단계**: 에이전트의 추론 plan/요약 텍스트.
  - **Tool call**: 도구 이름, 인자(JSON, 민감값 마스킹), 응답 시간, 결과 요약.
  - **Streaming**: 응답 생성 중에는 노드가 실시간으로 추가되고 스피너 표시.
- 보조 액션: tool call 항목의 [원본 응답] 보기로 결과 JSON 펼침. 패널 다시 접기.
- 성공 조건: 사용자가 추천 근거(어떤 추론·어떤 도구 호출)를 단계별로 확인 가능.
- 대안: 트레이스 데이터가 비어 있는 응답은 패널 미노출. 매우 긴 tool 응답은 앞 N줄만 표시 후 [전체 보기].

## 4. Requirements

### 4.1 Functional Requirements

| FR ID | 요구사항 | 출처 UC | 우선순위 |
|-------|---------|---------|---------|
| FR-01 | 로그인 화면: 국가 코드 선택 + 전화번호 입력 (E.164) | UC-01 | P0 |
| FR-02 | SMS 인증 코드 입력 + 재전송 / 음성 통화 대체 수단 | UC-01 | P0 |
| FR-03 | 인증 토큰 보안 저장(SecureStore) 및 자동 로그인 | UC-01 | P0 |
| FR-04 | 로그아웃: 인증 토큰·봇 토큰·로컬 캐시 삭제 후 로그인 화면 복귀 | UC-01 | P0 |
| FR-05 | 친구 추가 화면: 봇 토큰 입력 + 미리보기(`getMe`) | UC-02 | P0 |
| FR-06 | 친구 등록 시 중복 검사 및 오류 안내 | UC-02 | P0 |
| FR-07 | 친구 등록 직후 `/start` 자동 전송 | UC-02 | P1 |
| FR-08 | 봇 토큰 보안 저장(SecureStore) | UC-02 | P0 |
| FR-09 | 친구 리스트 화면: 표시명·아이콘·마지막 메시지·미확인 카운트 | UC-03 | P0 |
| FR-10 | 친구 항목 길게 누르기: 삭제 | UC-03 | P0 |
| FR-11 | 채팅 화면: 텍스트 입력·전송, 송수신 버블 렌더링 | UC-04 | P0 |
| FR-12 | 메시지 상태(전송 중/전송됨/응답 중/완료/실패) + 실패 시 재전송 | UC-04 | P0 |
| FR-13 | 메시지 타임스탬프 및 날짜 구분선 | UC-04 | P0 |
| FR-14 | **에이전트 응답 스트리밍 렌더링**: `message_delta` 청크를 실시간으로 누적해 버블에 점진 표시. 사용자가 자동 스크롤·중단(↓/Stop) 제어 가능. | UC-04 | P0 |
| FR-15 | **마크다운 풀-스펙 렌더링**(GFM 수준): 헤더(`#`~`######`), Bold/Italic/Strikethrough, 인라인/펜스 코드(언어별 하이라이트), 정렬·중첩 리스트, 체크박스, 표(table), 인용(blockquote), 인라인 링크/이미지, 수평선, 이모지. 스트리밍 중 미완성 토큰(`**`, ``` ```` 등)은 원문 노출 없이 안전하게 점진 적용. | UC-04 | P0 |
| FR-16 | 텔레그램 호환 Bot API 연동(`getMe`, `sendMessage`, `editMessageText`, `getUpdates`/`setWebhook`, `sendChatAction`) | UC-02, 04 | P0 |
| FR-17 | 응답 메시지 하단에 trace 요약 표시(thinking 단계 수·tool call 수) + 펼침/접힘 | UC-05 | P0 |
| FR-18 | thinking 노드 렌더링(plan/요약 텍스트, 순서 보존) | UC-05 | P0 |
| FR-19 | tool call 노드 렌더링(이름·인자·결과 요약·소요시간, 민감값 마스킹) | UC-05 | P0 |
| FR-20 | trace 이벤트 스트리밍 수신 및 실시간 렌더링(SSE 또는 WebSocket) | UC-04, 05 | P0 |
| FR-21 | tool call 원본 응답 JSON 펼침 / [전체 보기]로 긴 응답 처리 | UC-05 | P1 |
| FR-22 | iOS·Android 동등 지원 | 전 UC | P0 |

### 4.2 Non-functional Requirements
- 성능: 앱 콜드 스타트 2초 이내, 로컬 렌더링 100ms 이내.
- 보안: 인증 토큰·봇 토큰은 OS SecureStore에 저장, 통신은 HTTPS. 전화번호는 인증 목적 외 외부 공유하지 않음.
- 호환성: iOS 16+, Android 12+.
- 안정성: 네트워크 단절 시 송신 실패 표시 및 복귀 시 재전송.
- 국제화: 한국어 최우선. 국가 코드는 국제 표준(E.164) 기반.

### 4.3 Constraints & Assumptions
- 크로스 플랫폼 프레임워크는 React Native (Expo) 사용.
- 1차 릴리스는 단일 사용자·단일 기기·로컬 저장소 기반.
- 에이전트 백엔드는 Telegram 호환 Bot API + 확장 trace 스트림(SSE/WS) + 사용자 인증 엔드포인트를 제공한다고 가정.

## 5. Technical Architecture

### 5.1 System Context
```
[User]
  ↓ credentials / text input
[Agent Client (Mobile App)]  — 인증·봇 토큰 SecureStore 저장
  ↓ HTTPS (Auth API + Bot API + 확장 스트림)
[Agent Gateway / Bot API Bridge]
  ↓
[Agent Daemon]
```

### 5.2 Stack
- Framework: React Native (Expo) + Expo Router
- State: Zustand
- Storage: Expo SecureStore (인증·봇 토큰), expo-sqlite 또는 AsyncStorage (대화 캐시)
- Build: EAS

### 5.3 Backend Interface
- **Auth API (Telegram 표준 흐름)**:
  - `POST /v1/auth/send-code` — `{ phone_number }` → SMS 또는 음성 통화로 인증 코드 발송.
  - `POST /v1/auth/verify-code` — `{ phone_number, code }` → 검증 성공 시 인증 토큰 발급.
  - `POST /v1/auth/logout` — 인증 토큰 무효화.
  - `POST /v1/auth/refresh` — 만료된 토큰 갱신(refresh token 사용 여부는 결정 필요).
- **텔레그램 호환 Bot API(최소 메서드)**: `getMe`, `sendMessage`, `editMessageText`, `getUpdates` 또는 `setWebhook`, `sendChatAction`(typing). 봇 토큰을 URL 경로로 전달.
- **확장 — Trace 스트림** (SimpleClaw/OpenClaw 호환 브릿지):
  - 전송: SSE 또는 WebSocket으로 응답 청크 + trace 이벤트.
  - 이벤트 스키마
    - `event: thinking` — `{ step, summary, content }`
    - `event: tool_call` — `{ id, name, args, started_at }`
    - `event: tool_result` — `{ id, status, result_preview, latency_ms }`
    - `event: message_delta` — 텍스트 청크
  - 표준 텔레그램 봇(trace 미지원)은 자동 fallback — 본문만 표시, trace 패널 미노출.

### 5.4 Data Model
- `User`: `{ id, phone_number(E.164), display_name, auth_token, created_at }`.
- `Buddy`: 등록된 에이전트(봇 토큰, 봇 username, 표시명, 아이콘, 마지막 메시지 메타, trace 지원 여부).
- `Message`: `{ id, buddy_id, role(user/agent), text, status, created_at, trace_id? }`.
- `Trace`: `{ id, message_id, nodes[] }` — `nodes`는 `{ kind(thinking|tool_call|tool_result), seq, payload, started_at, latency_ms? }`의 시퀀스.

## 6. Success Metrics & Scope

### 6.1 KPI

| 지표 | 목표값 (MVP) |
|------|-------------|
| 로그인 성공률 | > 99% |
| 메시지 송신 성공률 | > 98% |
| 1차 응답 지연(p50) | < 4s |
| 스트리밍 첫 청크까지 지연(p50) | < 1s |

### 6.2 Scope In (MVP)
- 전화번호 + SMS 인증 기반 로그인 / 자동 로그인 / 로그아웃
- 봇 토큰을 통한 친구(에이전트) 추가
- 친구 리스트
- 1:1 텍스트 채팅 (송수신, 상태 표시, 타임스탬프)
- **응답 스트리밍 렌더링**(점진 표시 + 자동 스크롤·중단 제어)
- **마크다운 풀-스펙 렌더링**(GFM: 헤더·표·코드 하이라이트·리스트·체크박스·인용·링크·이미지)
- **thinking·tool call trace 가시화** (펼침/접힘 패널, 스트리밍 갱신, 민감값 마스킹)
- iOS·Android 지원

### 6.3 Scope Out (후속)
- 음성 입출력 (STT/TTS)
- Push 알림
- 인라인 액션 버튼·카드 메타데이터
- OAuth 외부 서비스 연동 카드
- OS 공유 시트 입력
- 자연어 검색·아카이브
- 통합 Inbox·채널별 알림 정책
- 앱 잠금(패스코드/생체 인증)
- 다중 디바이스 동기화·다중 사용자
- 친구 표시명 로컬 변경 / 메시지 액션(복사·인용·공유)
- 과거 대화 페이지네이션(첫 출시 시점에 대화량이 많지 않다는 가정)
- trace 노드 [이 단계 다시 실행] 등 재호출 액션

## 7. Milestones

| Milestone | 종결 조건 | 포함 FR | 예상 기간 |
|-----------|----------|---------|----------|
| **M1 — MVP** | 전화번호 로그인 → 친구 추가 → 친구 리스트 → 채팅(스트리밍·마크다운·trace 포함)이 iOS·Android에서 동작, 로그아웃 정상 동작 | FR-01 ~ FR-22 | 4~5주 |

후속 마일스톤(Push, 음성, 카드, 다중 디바이스 등)은 별도 PRD/이슈로 분리.

## 8. Decisions / Open Questions
- 결정: MVP 범위를 로그인 / 친구 추가 / 친구 리스트 / 채팅(스트리밍 + 마크다운 풀-스펙) / **thinking·tool-call trace** 5개 영역으로 확정.
- 결정: **기반 규칙은 전부 Telegram 기준** — 인증(전화번호 + SMS), 버디(봇) 관리, 채팅 프로토콜(Bot API). Telegram이 못 다루는 영역(GFM 마크다운·스트리밍·trace)만 명시적 확장.
- 결정: 로그인은 **전화번호 + SMS 인증 코드**(Telegram 표준 흐름).
- 결정: 친구 추가 입력 단위는 **봇 토큰**(봇 핸들/딥링크는 후속).
- 결정: 친구 = 별도 봇 모델(다중 사용자·그룹 채널 제외).
- 결정: 표준 Telegram 봇(확장 미지원) 자동 fallback — 본문만 표시, trace 패널 미노출.
- 질문: SMS 발송 백엔드(자체 게이트웨이 vs. Twilio Verify vs. Firebase Phone Auth) — 백엔드 팀과 협의.
- 질문: 인증 코드 길이·만료 정책(텔레그램은 5자리·5분 기본) — 보안 정책 확정 필요.
- 질문: 인증 토큰 만료·갱신 정책(refresh token 사용 여부, 만료 기간).
- 질문: trace 패널 기본값(자동 펼침 vs. 접힘) 및 민감값 마스킹 규칙 디테일.
- 질문: 스트리밍 청크 단위(토큰 vs. 문자 vs. 단어) — UX 매끄러움 vs. 네트워크 비용.
