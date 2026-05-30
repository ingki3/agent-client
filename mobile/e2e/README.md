# E2E flows (Maestro)

Covers the core USER_FLOW §3 journeys (TECH_SPEC §7). Single-user onboarding: enter a
Telegram user id (chat_id) once — no login/OTP.

## Prerequisites

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash   # install Maestro
# Build & install the app on a simulator/device first:
cd mobile && npx expo run:ios   # or run:android
```

## Run

```bash
cd mobile
maestro test e2e/01-signup-first-chat.yaml
maestro test e2e/02-markdown-and-trace.yaml
maestro test e2e/04-friend-delete.yaml
maestro test e2e/05-logout.yaml

# Whole suite (excludes the live-buddy flow, which needs a token):
maestro test e2e/ --exclude-tags=live

# Live buddy add — pass a real bot token via env (never commit it):
maestro test -e BOT_TOKEN=123456789:ABC... e2e/03-add-live-buddy.yaml
```

## Flows

| File | Journey | Notes |
|---|---|---|
| `subflows/login.yaml` | 사용자 ID 입력 온보딩 | reused by every flow via `runFlow` |
| `01-signup-first-chat.yaml` | 온보딩 → mock 채팅 → 스트리밍 응답 | |
| `02-markdown-and-trace.yaml` | GFM 렌더 + trace 펼침 + M-01 + 마스킹 | |
| `03-add-live-buddy.yaml` | 봇 토큰 → 실제 `getMe` → 등록 | needs `-e BOT_TOKEN=…` + network |
| `04-friend-delete.yaml` | 길게 누름 → 삭제 | |
| `05-logout.yaml` | 초기화 → 온보딩 복귀 | |

`appId` = `dev.simplist.agentclient.mockup` (from app.json). Update it if the bundle id changes.

## Android

Build needs **JDK 17** (Gradle 8.8 rejects JDK 21+/25 — `Unsupported class file major
version`). Point Gradle at it:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd mobile && npx expo run:android        # builds, installs on the running emulator
```

Android's `applicationId` is `com.dev.simplist.agentclient.mockup` (Expo prefixes `com.`),
which differs from iOS `dev.simplist.agentclient.mockup`. Run the suite against a copy with
the appId rewritten, targeting the emulator:

```bash
cp -r e2e /tmp/e2e-android
find /tmp/e2e-android -name '*.yaml' -exec sed -i '' \
  's/appId: dev.simplist.agentclient.mockup/appId: com.dev.simplist.agentclient.mockup/' {} +
maestro --device emulator-5554 test /tmp/e2e-android --exclude-tags=live
```

Verified: 01/02/04/05 pass on a Pixel_7 emulator.
