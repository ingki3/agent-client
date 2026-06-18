# Agent Client - Engineering Handover

이 문서는 Agent Client의 현재 구현 상태를 기준으로 한 engineering handover입니다. `PRD.md`, `TECH_SPEC.md`, `USER_FLOW.md`보다 최신 구현 사실을 우선합니다.

현재 브랜치: `work/after-pr-24`

주의: 작업 트리는 여러 코드/문서 변경이 남아 있는 dirty 상태입니다. 커밋/머지 전에는 `git status`와 diff를 확인하고, 사용자가 만든 변경을 되돌리지 마세요.

## 1. 제품 목적

Agent Client는 AI agent와 협업하기 위한 전용 메신저입니다.

일반 Telegram 앱은 사람 간 대화에는 충분하지만, agent 답변의 구조화된 후속 액션, tool output, 링크/파일 처리, TTS, streaming, push, inline keyboard를 앱 수준에서 다루기 어렵습니다. 이 프로젝트는 Telegram 프로토콜을 통신 기반으로 사용하되, agent 협업에 필요한 UI와 relay 기능을 직접 제공합니다.

현재 핵심 방향:

- 사람 사용자는 Telegram user account로 로그인합니다.
- Agent는 Telegram bot 또는 Telegram-compatible peer로 취급합니다.
- 앱은 agent 답변을 보기 좋게 렌더링하고, helper AI가 후속 액션 UI를 붙입니다.
- relay는 MTProto 세션, 메시지 정규화, push, helper AI, media proxy, TTS를 담당합니다.

## 2. 현재 구성

```text
AgentClient/
├── Agent_Client.md
├── README.md
├── PRD.md
├── TECH_SPEC.md
├── USER_FLOW.md
├── mobile/
│   ├── app/                       Expo Router routes
│   ├── app/_runtime/              screen orchestration
│   ├── src/domain/                pure TS entities, markdown, message rules
│   ├── src/application/           Zustand stores and usecases
│   ├── src/infrastructure/        relay API, push, attachments, storage
│   └── src/ui/chat/               chat UI components
└── relay/
    ├── src/index.ts               app bootstrap
    ├── src/http/routes/           route modules
    ├── src/mtproto.ts             GramJS manager
    ├── src/store.ts               SQLite schema and queries
    ├── src/helper/                helper AI prompt/output/submit context
    ├── src/services/              link preview and related services
    ├── src/tts.ts                 TTS script/audio generation
    └── src/snapshot.ts            normalized message snapshot
```

Mobile stack:

- Expo SDK 55
- React Native 0.83
- Expo Router
- Zustand
- TypeScript strict
- Expo Notifications, SecureStore, SQLite, Document/Image/Location/AV/FileSystem modules

Relay stack:

- Node ESM
- Fastify
- better-sqlite3
- GramJS (`telegram`)
- Expo Server SDK
- OpenAI-compatible LLM integration for helper AI and TTS script rewriting, using Gemini by default

## 3. 현재 운영/설정 값

App config:

- `mobile/app.json` `expo.extra.relayBase = "http://telegram-relay.2prostream.com"`
- `mobile/app.json` `expo.extra.eas.projectId = "3a5f18ec-c8c8-4eed-94b1-4d1e593efca2"`
- Android package: `dev.simplist.agentclient.mockup`
- Android cleartext is enabled because the app currently uses HTTP relay base.

EAS/Firebase:

- EAS account/project: `@ingki3/agent-client-mockup`
- EAS project id: `3a5f18ec-c8c8-4eed-94b1-4d1e593efca2`
- Firebase project id: `agent-client-73b5b`
- Firebase project number: `608765513274`
- FCM V1 service account email: `agentclient-fcm-v1@agent-client-73b5b.iam.gserviceaccount.com`
- FCM V1 credential is uploaded to EAS Android production credentials.

Local files:

- `mobile/google-services.json` exists locally and must stay uncommitted.
- `mobile/.secrets/*service-account*.json` is ignored. Upload service account keys to EAS, then delete local copies.

Relay:

- Local: `http://127.0.0.1:8787`
- Public base used by app: `http://telegram-relay.2prostream.com`
- tmux session used during development: `agentclient-relay`
- Health check: `curl http://127.0.0.1:8787/health`

## 4. Message flow

```text
mobile app
  auth/buddies/chat stores
  ChatComposer, ChatBubble, helper forms, inline keyboard, attachments
      |
      | HTTP/SSE
      v
relay
  Fastify routes
  GramJS TelegramClient per device
  SQLite snapshots/devices/subscriptions
  helper AI, TTS, link preview, media proxy, Expo Push
      |
      | MTProto
      v
Telegram servers
```

Send text:

1. 앱이 optimistic user message를 추가합니다.
2. `relayClient.sendAs(peerId, text, replyTo?)`가 `POST /send`를 호출합니다.
3. relay가 GramJS로 사용자의 Telegram 계정에서 peer에게 메시지를 보냅니다.
4. Telegram message id가 돌아오면 앱이 optimistic id를 `tg-{message_id}`로 reconcile합니다.

Receive:

1. relay의 GramJS `NewMessage` handler가 incoming/outgoing 메시지를 받습니다.
2. Telegram entity를 markdown으로 복원하고, media/link preview/inline keyboard를 정규화합니다.
3. `message_snapshots`에 upsert하고 `/messages/stream` 구독자에게 `message_updated`를 publish합니다.
4. incoming 메시지는 subscription 대상 기기에 Expo push를 보냅니다.
5. 앱은 열린 채팅방에서 SSE로 갱신을 받고, 재진입/복구 시 `/messages/sync`와 legacy `/pull` 경로로 보강합니다.

DB 저장과 화면 streaming은 분리되어 있습니다. DB cursor는 snapshot 안정성을 위한 값이고, UI는 stream event를 받아 즉시 upsert합니다.

## 5. Relay route map

Auth:

- `POST /auth/start`
- `POST /auth/code`
- `POST /auth/2fa`
- `POST /auth/logout`
- `GET /auth/status`

Peers:

- `GET /peers/list`
- `POST /peers/resolve`
- `POST /peers/remove`

Messages:

- `POST /send`
- `POST /messages/sync`
- `GET /messages/stream`
- `GET /pull` - legacy update pull compatibility
- `POST /form/submit`
- `POST /helper/submit`
- `POST /inline-keyboard/callback`

Media:

- `POST /sendMedia`
- `POST /sendMediaGroup`
- `GET /media`

Link/TTS/system:

- `POST /link/preview`
- `POST /tts/script`
- `POST /tts/audio`
- `GET /tts/audio/:cacheKey`
- `POST /register`
- `POST /unregister`
- `GET /health`

## 6. Mobile implementation notes

Auth:

- Phone/code/2FA flow is implemented in `mobile/app/(auth)`.
- Relay `deviceSecret` is stored locally and used as Bearer auth for device-scoped routes.
- Telegram session string never lives on the mobile app. It is encrypted and stored in relay DB.

Buddies:

- A buddy is a resolved Telegram peer.
- Add flow resolves `@username` through relay and subscribes the current device.
- Peer list can be restored from relay, so reinstall/login does not depend only on local app storage.

Chat:

- Chat runtime lives in `mobile/app/_runtime/chat.ts`.
- Relay snapshots are converted in `mobile/app/_runtime/relaySnapshot.ts`.
- `chat-store` upserts messages rather than blindly appending.
- Chat room entry scrolls to recent content and marks messages read.
- Auto-scroll should only occur when the user is near bottom or when a local send happens. Be careful when changing stream/sync code because repeated upserts can move the screen.

Composer and attachments:

- Composer supports text plus staged attachments.
- File/photo/video/camera/location/voice are selected first, then sent with an optional comment.
- Location is sent as a map URL.
- Media groups are bucketed where Telegram allows grouping.
- Received media uses relay `/media` URLs and renders as image/file/voice attachments.

Rendering:

- Markdown renderer handles headers, emphasis, code, lists, tables, blockquote, links, and code blocks.
- Link preview card shows URL title/description/representative image.
- Telegram inline keyboard is rendered with app-styled controls, not raw JSON.
- Helper action submit shows only the selected user-facing value as a bubble; hidden context JSON is sent to the agent but filtered from normal display.

## 7. Helper AI

Helper AI runs on the relay after an agent answer is complete enough to evaluate. It uses Gemini through the OpenAI-compatible chat completions endpoint by default and outputs the app's fixed JSON shape.

Supported helper item types:

- `quick_reply`
- `single_select`
- `multi_select`
- `input_form`
- `confirm_action`
- `open_link`
- `none` / empty result when no follow-up is useful

Important rules:

- Do not run helper AI when Telegram inline keyboard already exists.
- Do not run helper AI for progress logs, tool transcripts, empty fragments, or obvious streaming partials.
- Generate generally useful follow-ups, not prompts tied to a single known email/Youtube case.
- Submit context should include the source message, preview/source URL if present, and recent conversation context, not only the last transcript.
- Logs should include `helper.generate.*`, `helper.submit.*`, peer id, message id, item count, and source summary enough to debug missing chips.
- TTS script/audio generation waits for helper pending/in-flight work to finish before using the configured LLM. Helper is automatic on each agent reply; TTS is user-triggered and should not starve helper generation.

Current LLM defaults:

- `GEMINI_API_KEY=...`
- `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `LLM_API_KEY` defaults to `GEMINI_API_KEY`
- `LLM_MODEL=gemini-3.5-flash`
- `LLM_MAX_TOKENS=32000`
- `LLM_HELPER_MAX_TOKENS=1024`
- `LLM_TTS_MAX_TOKENS=2048`
- `LLM_CONCURRENCY=4`

Display rule:

- The user sees the selected value as a normal outgoing bubble.
- The agent receives `agent_helper_response` fenced JSON with hidden context.
- The app hides those helper JSON messages from the visible transcript.

## 8. Inline keyboard

Telegram Bot API/MTProto inline keyboard is supported.

- Bot API path extracts inline keyboard in `relay/src/poller.ts`.
- MTProto path extracts inline keyboard in `relay/src/telegram/inlineKeyboard.ts`.
- App renders it through `InlineKeyboardPanel`.
- Callback buttons call `POST /inline-keyboard/callback`.
- URL-like buttons open the target URL.
- Unsupported button types are rendered disabled or handled conservatively.

When inline keyboard exists, helper AI should not add additional helper chips because the agent already supplied an action surface.

## 9. Link preview

Two sources exist:

- Telegram webpage media from received messages.
- App/relay explicit preview fetch through `POST /link/preview`.

The app should show a card with title, description, host/site name, and image when available. The old black quick-reply chips for URL analysis should not be confused with link preview cards.

## 10. TTS

Relay TTS routes:

- `POST /tts/script`: converts an agent answer into a speakable script.
- `POST /tts/audio`: creates/caches MP3 audio and returns `audioUrl`.
- `GET /tts/audio/:cacheKey`: serves cached audio.

Design intent:

- Default voice should be an energetic male Korean voice when available.
- Script generation should be conversational and preserve the agent's existing tone where useful.
- Modes include brief/explain/action-items style outputs.

If audio generation fails, check relay logs for `tts audio failed` and verify the local TTS dependency/model path configured in `relay/src/tts.ts`.

## 11. Push notification

Push is Expo Push + Android FCM V1.

Required app config:

- `expo.extra.eas.projectId`
- `expo-notifications` plugin
- Android `POST_NOTIFICATIONS`
- `google-services.json` present for native release build

Required EAS/Firebase config:

- Firebase Android app package must match `dev.simplist.agentclient.mockup`.
- FCM V1 service account key must be uploaded to EAS Android credentials.
- Local service account JSON must not be committed.

Current verified state:

- App generated an Expo push token.
- App called relay `/register` with token length 41.
- Relay DB had the device row with Android platform and Expo token.
- Expo Push API direct send returned status `ok`.
- Push receipt returned status `ok`.

Useful checks:

```sh
adb -s <device-id> logcat -d -s ReactNativeJS | rg -i "\\[push\\]|\\[relay\\]|token|register"
sqlite3 relay/relay.db "SELECT device_id, platform, length(expo_push_token), datetime(last_seen_at/1000,'unixepoch','localtime') FROM devices;"
```

Direct push smoke:

```sh
export TOKEN=$(sqlite3 relay/relay.db "SELECT expo_push_token FROM devices ORDER BY last_seen_at DESC LIMIT 1;")
PATH=/usr/local/bin:$PATH node - <<'NODE'
const token = process.env.TOKEN;
fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: token, title: 'AgentClient 테스트', body: 'Push credential까지 정상입니다.' })
}).then(async res => console.log(res.status, await res.text()));
NODE
```

## 12. Build and install

Relay:

```sh
cd relay
npm install
npm start
```

Mobile typecheck/lint:

```sh
cd mobile
npm run typecheck
npm run lint
```

Android release build:

```sh
cd mobile/android
PATH=/usr/local/bin:$PATH \
JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED' \
GRADLE_OPTS='--enable-native-access=ALL-UNNAMED' \
./gradlew :app:assembleRelease \
  -Dorg.gradle.jvmargs='--enable-native-access=ALL-UNNAMED -Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'
```

Install:

```sh
adb -s <device-id> install -r app/build/outputs/apk/release/app-release.apk
```

Known local build issue:

- Default `/opt/homebrew/bin/node` can fail with missing `llhttp`. Use `PATH=/usr/local/bin:$PATH`.
- If native config/autolinking is stale, clear:

```sh
cd mobile/android
rm -rf app/.cxx app/build/generated/autolinking
```

## 13. Test expectations

For code changes, do not finish without running relevant tests and reporting results.

Recommended baseline:

```sh
cd mobile && npm run typecheck && npm run lint
cd relay && npm run typecheck && npm test
```

When user-visible mobile behavior changes:

1. Build Android release APK.
2. Install on the connected phone.
3. Verify the changed flow on device.
4. Check ReactNativeJS logs for push/relay/chat errors when relevant.

When relay protocol changes:

1. Run relay typecheck and tests.
2. Restart relay.
3. Check `/health`.
4. Confirm app can login/sync/send/receive.

## 14. Known gotchas

- `app.json` changes can be hidden by Gradle/native cache. Rebuild cleanly or clear `app/.cxx` and generated autolinking.
- If relay base changes, make sure both app config and in-app relay setting are aligned.
- Push token creation requires a real EAS project id. Fake IDs produce `EXPERIENCE_NOT_FOUND`.
- Android push delivery requires FCM V1 credentials in EAS. Missing credentials produce Expo push `InvalidCredentials`.
- Empty Expo push token means pull-only; relay must not delete the device for that.
- Telegram user-account automation can hit `FLOOD_WAIT`; surface retry information and keep usage human-paced.
- Helper JSON context is intentionally hidden from the transcript. If JSON appears to the user, check hidden-message filtering and helper submit formatting.
- Streaming screen jumps usually mean a sync/stream upsert is triggering unconditional scroll-to-end.

## 15. What is intentionally not complete

- Fully automated e2e for Telegram phone/code login is not practical without a controllable test account/code channel.
- iOS native permission strings for all attachment paths were not recently verified.
- Received media proxy has basic caching headers, but no persistent media cache.
- Long Telegram history backfill is limited to the current sync path and should be expanded carefully if needed.
- Legacy Bot API paths remain for compatibility, but the main product path is MTProto user-account relay.
