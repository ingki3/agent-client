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

## Android — NOT yet verified

> **Status: the Android build does not yet complete on this machine.** The flows below are
> iOS-verified and platform-agnostic (testIDs map to Android `resource-id`), but the suite
> has **not** been run against an installed Android build. Don't trust an Android pass
> until the build issues below are resolved.

Known blockers found while attempting an Android build:

1. **JDK version** — Gradle 8.8 (RN 0.74) needs **JDK ≤ 22**. The system default here is
   JDK 25 → `Unsupported class file major version 69`. Use Android Studio's bundled JBR 21:
   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   ```
2. **NDK install hangs** — with JBR 21 the build progresses but then **hangs while
   installing NDK 25.1.8937393** during `Configure project :expo-sqlite` (sat ~30 min with
   no progress). Likely needs the NDK pre-installed via Android Studio's SDK Manager, or an
   `ndkVersion` pin, before `expo run:android` can finish non-interactively.

`applicationId` is `dev.simplist.agentclient.mockup` (same as iOS — confirmed in
`android/app/build.gradle`), so once a build installs, run the suite directly:

```bash
# boot emulator: $ANDROID_HOME/emulator/emulator -avd Pixel_7
maestro --device emulator-5554 test e2e/ --exclude-tags=live
```
