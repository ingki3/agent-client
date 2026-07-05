# Agent Client

Agent Client는 Telegram 프로토콜을 활용해 AI agent와 협업하기 위한 특수 목적 메신저입니다. 일반 메신저처럼 대화하되, agent 답변 위에 후속 액션, 링크 미리보기, 첨부, TTS, push, inline keyboard 같은 agent 협업용 UI를 얹는 것이 목표입니다.

현재 구현은 `mobile/`의 Expo/React Native 앱과 `relay/`의 Node/Fastify relay 서버로 구성됩니다. 앱은 Telegram user account로 로그인하고, relay는 MTProto 세션을 유지하면서 메시지 송수신, helper AI, media proxy, push fan-out을 담당합니다.

추가로 relay는 **MCP 서버**로도 동작해, MCP를 지원하는 Telegram 봇이 대화 중에 **사용자의 폰을 제어**할 수 있습니다. 봇이 도구를 호출하면 relay가 FCM 데이터 메시지로 주머니 속 폰(백그라운드/종료 상태)을 깨우고, 폰이 네이티브로 조용히 실행한 뒤 결과를 돌려줍니다. 위치·문자·연락처·미디어 읽기(SENSE)와 문자·미디어 전송(ACTION)을 지원합니다. 상세: [relay/MCP.md](./relay/MCP.md).

## 현재 구현된 기능

- Telegram 전화번호/코드/2FA 기반 로그인: bot token이 아니라 사용자의 Telegram 계정으로 agent bot에게 메시지를 보냅니다.
- Agent buddy 추가: `@username`으로 bot/agent를 resolve하고 채팅방을 생성합니다.
- 실시간 메시지 반영: relay의 message snapshot/SSE를 통해 채팅방에 열린 메시지를 갱신하고, DB 저장과 화면 스트림을 분리합니다.
- Helper AI 후속 액션: agent 답변을 보고 quick reply, single/multi select, 입력 폼, 확인 액션 등을 생성합니다. Telegram inline keyboard가 있는 메시지는 helper AI를 건너뜁니다.
- Link preview: URL 메시지에 제목, 설명, 대표 이미지를 카드로 표시합니다.
- Telegram inline keyboard: callback/url/web_app/login/switch_inline/copy 계열 버튼을 앱 UI로 렌더링합니다.
- 첨부 전송: 파일, 사진/동영상, 카메라, 위치, 음성 녹음을 composer에서 staging한 뒤 코멘트와 함께 전송합니다.
- 첨부 수신: relay media proxy를 통해 받은 사진/파일/음성/문서를 앱에서 attachment로 표시합니다.
- TTS: agent 답변을 대화형 script로 변환하고 음성으로 들을 수 있는 흐름을 제공합니다.
- Push notification: Expo Push + FCM V1 credential로 Android 실기기 push가 동작하도록 구성했습니다.
- 앱 설정: relay base URL을 앱 설정에서 관리할 수 있습니다.
- 폰 제어 (MCP): relay가 MCP 서버로 폰 제어 도구 7종(`get_location`, `read_sms`, `find_contact`, `list_media`, `fetch_media`, `send_sms`, `send_media`)을 노출합니다. FCM 고우선순위 데이터 메시지로 종료된 앱까지 깨워 네이티브 Kotlin으로 실행하고 결과를 회신하며, 모든 호출은 relay에 감사(audit) 기록됩니다. 권한은 앱 설정의 "에이전트 폰 제어 권한"에서 부여합니다.

## 아키텍처

```text
mobile app
  Expo SDK 55 / React Native 0.83 / Expo Router / Zustand
  auth, buddies, chat, notifications stores
  chat UI, helper forms, link preview, inline keyboard, attachments, TTS controls

relay server
  Node / Fastify / better-sqlite3 / GramJS / Expo Server SDK / @modelcontextprotocol/sdk
  MTProto user sessions, peer resolve, send, media proxy, message snapshots, helper AI, push
  MCP server (Streamable HTTP) + FCM v1 command dispatcher for phone control

Telegram
  MTProto user-account path for real user sending
  legacy Bot API path remains for compatibility/testing

phone-command pipe (MCP)
  MCP client (bot) → relay /mcp → FCM data-message wake → phone native executor → /command/result
  native Kotlin FirebaseMessagingService runs while backgrounded/killed; no JS, no banner
```

주요 흐름:

1. 앱이 relay에 `phone -> code -> 2FA` 인증을 요청합니다.
2. relay가 Telegram MTProto 세션을 암호화해 저장합니다.
3. 앱이 `@username`을 추가하면 relay가 peer를 resolve하고 subscription을 등록합니다.
4. 앱이 메시지를 보내면 relay가 사용자의 Telegram 계정으로 agent bot에게 전송합니다.
5. relay가 Telegram 메시지를 snapshot으로 정규화하고 앱에 streaming/SSE 및 pull로 전달합니다.
6. helper AI는 agent 답변이 완료된 뒤 필요한 경우에만 후속 액션 UI를 생성합니다.

## 디렉터리

```text
AgentClient/
├── README.md
├── Agent_Client.md       # 현재 구현 기준 engineering handover
├── PRD.md
├── TECH_SPEC.md
├── USER_FLOW.md
├── mobile/               # Expo/React Native 앱
└── relay/                # Telegram relay 서버
```

상세 실행/운영 문서는 다음을 봅니다.

- [mobile/README.md](./mobile/README.md)
- [relay/README.md](./relay/README.md)
- [relay/MCP.md](./relay/MCP.md) — 폰 제어 MCP 통합 가이드 (엔드포인트·토큰·도구·운영 주의)
- [Agent_Client.md](./Agent_Client.md)

## 실행

Relay:

```sh
cd relay
npm install
npm start
```

Mobile:

```sh
cd mobile
npm install
npm run android
```

Android release APK:

```sh
cd mobile/android
PATH=/usr/local/bin:$PATH \
JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED' \
GRADLE_OPTS='--enable-native-access=ALL-UNNAMED' \
./gradlew :app:assembleRelease \
  -Dorg.gradle.jvmargs='--enable-native-access=ALL-UNNAMED -Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'

adb install -r app/build/outputs/apk/release/app-release.apk
```

로컬 기본 Node가 `/opt/homebrew`의 깨진 llhttp를 잡는 환경에서는 `PATH=/usr/local/bin:$PATH`를 붙여 실행합니다.

## 현재 배포/설정 상태

- Relay public base: `http://telegram-relay.2prostream.com`
- Local relay: `http://127.0.0.1:8787`
- Android package: `dev.simplist.agentclient.mockup`
- EAS project: `@ingki3/agent-client-mockup`
- EAS project id: `3a5f18ec-c8c8-4eed-94b1-4d1e593efca2`
- Firebase project id: `agent-client-73b5b`
- FCM V1 credential: EAS Android production credentials에 등록 완료

`mobile/google-services.json`과 service account key는 secret입니다. `google-services.json`은 로컬에만 두고 git에는 커밋하지 않습니다. service account key는 EAS credentials에 업로드한 뒤 로컬 파일을 삭제합니다.

## 검증

최근 확인된 기본 검증:

```sh
cd mobile && npm run typecheck && npm run lint
cd relay && npm run typecheck && npm test
```

Android release build와 실기기 설치도 확인했습니다. Push는 Expo Push API 직접 발송과 receipt `ok`까지 확인했고, 앱 로그에서 push token 등록 및 relay `/register` 성공을 확인했습니다.

문서와 실제 구현이 다르면 [Agent_Client.md](./Agent_Client.md)를 우선 기준으로 삼습니다.
