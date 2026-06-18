# Agent Client Relay

Agent Client relay는 Telegram user-account session을 서버에서 유지하고, 모바일 앱이 agent bot과 안정적으로 대화할 수 있게 해주는 Node/Fastify 서버입니다.

주요 역할:

- Telegram MTProto 로그인과 session 보관
- `@username` peer resolve
- 사용자 계정으로 메시지 전송
- Telegram 수신 메시지 정규화 및 snapshot 저장
- SSE/pull 기반 앱 동기화
- helper AI 후속 액션 생성
- URL link preview 생성
- media upload/download proxy
- Telegram inline keyboard 정규화
- Expo Push fan-out
- TTS script/audio 생성 흐름

## 실행

```sh
cd relay
npm install
npm start
```

개발 watch:

```sh
npm run dev
```

기본 포트는 `8787`입니다. 현재 public relay는 `http://telegram-relay.2prostream.com`이고, 로컬 프로세스는 `http://127.0.0.1:8787`에서 동작합니다.

## 환경 변수

`relay/.env`는 git ignore 대상입니다.

```sh
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
RELAY_MASTER_KEY=...
PORT=8787
HOST=0.0.0.0
RELAY_DB=relay.db
GEMINI_API_KEY=...
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=
LLM_MODEL=gemini-3.5-flash
LLM_MAX_TOKENS=32000
LLM_HELPER_MAX_TOKENS=1024
LLM_TTS_MAX_TOKENS=2048
LLM_CONCURRENCY=4
```

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`: <https://my.telegram.org/apps>에서 발급합니다.
- `RELAY_MASTER_KEY`: Telegram session과 legacy bot token 암호화에 사용합니다. `openssl rand -hex 32`로 생성합니다.
- `GEMINI_API_KEY`: helper AI와 TTS script 생성에 쓰는 Gemini API key입니다.
- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`: OpenAI-compatible 호출 설정입니다. 기본값은 Gemini endpoint, `GEMINI_API_KEY`, `gemini-3.5-flash`입니다. 로컬 모델을 쓰려면 `LLM_BASE_URL=http://127.0.0.1:8000/v1`, `LLM_API_KEY=not-needed`, `LLM_MODEL=...`처럼 명시합니다.
- `LLM_CONCURRENCY`: relay가 모델 endpoint에 동시에 보낼 수 있는 요청 수입니다. 기본값은 `4`입니다.

`RELAY_MASTER_KEY`를 바꾸면 기존 encrypted session을 복호화할 수 없으므로 다시 로그인해야 합니다.

## API 개요

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/start` | 전화번호로 Telegram login code 요청 |
| `POST` | `/auth/code` | login code 제출 |
| `POST` | `/auth/2fa` | Telegram cloud password 제출 |
| `POST` | `/auth/logout` | Telegram logout 및 session revoke |
| `GET` | `/auth/status` | device session 상태 확인 |
| `POST` | `/peers/resolve` | `@username`을 Telegram peer로 resolve |
| `POST` | `/register` | device, push token, peer subscription 등록 |
| `POST` | `/unregister` | subscription 또는 device 해제 |
| `POST` | `/send` | text 메시지를 사용자 계정으로 전송 |
| `POST` | `/sendMedia` | 파일/사진/음성 등 단일 media 전송 |
| `POST` | `/sendMediaGroup` | 사진/동영상/document album 전송 |
| `GET` | `/pull` | 저장된 update/snapshot pull |
| `POST` | `/messages/sync` | Telegram/DB snapshot 동기화 |
| `GET` | `/messages/stream` | message snapshot event stream |
| `GET` | `/media` | Telegram media/download proxy |
| `POST` | `/link/preview` | URL metadata preview 생성 |
| `POST` | `/form/submit` | form 응답을 agent 명령으로 변환 |
| `POST` | `/helper/submit` | 앱 helper action 선택 결과를 agent 명령으로 변환 |
| `POST` | `/inline-keyboard/callback` | Telegram inline keyboard callback 실행 |
| `POST` | `/tts/script` | agent 답변 기반 음성용 script 생성 |
| `POST` | `/tts/audio` | TTS audio 생성 및 cache URL 반환 |
| `GET` | `/tts/audio/:cacheKey` | cached TTS audio 반환 |
| `GET` | `/health` | 프로세스, session, loop 상태 확인 |

정확한 request/response type은 `relay/src/index.ts`, `relay/src/types.ts`, `relay/src/helper/*`, `relay/src/services/*`를 기준으로 확인합니다.

## Message snapshot

Relay는 Telegram event를 바로 앱 전용 메시지로 정규화해 `message_snapshots` 테이블에 저장합니다.

정규화 항목:

- `role`: incoming/outgoing 기반 `agent` 또는 `user`
- `text`: Telegram entity를 markdown으로 복원한 텍스트
- `preview`: URL link preview
- `media`: relay `/media` URL이 포함된 attachment descriptor
- `inlineKeyboard`: Telegram inline keyboard를 앱 버튼 모델로 변환한 값
- `helperItems`: helper AI가 생성한 후속 액션
- `tts`: TTS script/audio metadata

Snapshot cursor는 DB 저장/동기화용이고, 화면의 streaming 업데이트는 SSE event로 별도 전달합니다. 이 분리 덕분에 메시지 저장 안정성과 화면 갱신을 따로 다룰 수 있습니다.

## Helper AI

Helper AI는 agent 답변을 보고 사용자가 쉽게 이어서 답할 수 있는 UI를 생성합니다.

기본 모델 호출은 Gemini OpenAI-compatible `/chat/completions`입니다.

```sh
GEMINI_API_KEY=...
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.5-flash
LLM_CONCURRENCY=4
```

지원 type:

- `quick_reply`
- `single_select`
- `multi_select`
- `input_form`
- `confirm_action`
- `open_link`
- `none`

규칙:

- 출력은 앱과 약속된 JSON schema로 고정합니다.
- 별도 대응이 필요 없으면 `none` 또는 빈 item을 반환합니다.
- Telegram inline keyboard가 이미 있는 메시지는 helper AI를 실행하지 않습니다.
- 진행 로그, tool transcript, 불완전한 streaming 조각은 helper 대상에서 제외합니다.
- helper action submit 시 사용자가 보는 말풍선에는 선택한 value만 표시하고, agent에게 보내는 숨김 context에는 최근 대화와 source preview를 포함합니다.
- TTS script/audio 생성은 helper AI의 pending/in-flight 작업이 끝난 뒤 시작합니다. 새 agent 답변마다 자동 실행되는 helper가 모델 호출 우선순위를 먼저 갖도록 하기 위한 규칙입니다.

## Push

Relay는 Expo Push token을 devices 테이블에 저장하고, incoming message가 생기면 subscription 대상 기기에 push를 보냅니다.

주의:

- 빈 Expo token은 pull-only 상태로 취급합니다. 빈 token 때문에 device를 삭제하지 않습니다.
- `DeviceNotRegistered` receipt가 온 경우에만 device/subscription을 정리합니다.
- Android production push는 EAS에 FCM V1 service account credential이 등록되어 있어야 합니다.

## 테스트

```sh
cd relay
npm run typecheck
npm test
```

MTProto live smoke:

```sh
npm run smoke:mtproto -- <+phone> <botUsername>
```

Relay 상태 확인:

```sh
curl http://127.0.0.1:8787/health
sqlite3 relay.db "SELECT device_id, platform, length(expo_push_token), datetime(last_seen_at/1000,'unixepoch','localtime') FROM devices;"
```

## 운영 메모

- Relay는 항상 켜져 있어야 합니다. 프로세스가 죽으면 실시간 수신, helper 생성, push가 멈춥니다.
- 현재는 mac mini에서 tmux session `agentclient-relay`로 운용했습니다.
- Cloudflare tunnel 또는 reverse proxy는 relay의 plain HTTP `localhost:8787`로 연결합니다.
- Telegram user-account 자동화는 Telegram 정책과 flood wait 영향을 받습니다. 사람 수준 사용량을 전제로 운영합니다.
- `relay/.env`, `relay/relay.db`, service account key는 커밋하지 않습니다.
