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

Verified: **4/4 flows pass on a Pixel_7 emulator (Android 14)**.

Two gotchas on this machine:

1. **JDK** — Gradle 8.8 (RN 0.74) needs **JDK ≤ 22**; the system default JDK 25 fails with
   `Unsupported class file major version 69`. Use Android Studio's bundled JBR 21.
2. **First build is slow (~19 min)** — it downloads the NDK and compiles native code.
   It is *not* hung; let it finish. Subsequent builds are fast.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
$ANDROID_HOME/emulator/emulator -avd Pixel_7 &     # boot an emulator
cd mobile && npx expo run:android                  # builds + installs (keep Metro running)
```

`applicationId` is `dev.simplist.agentclient.mockup` (same as iOS), so the flows run as-is.
This is a **dev build**, so Metro must be up and reachable — if you launch the app manually
(not via `expo run:android`), set the Metro tunnel first, then run the suite:

```bash
adb -s emulator-5554 reverse tcp:8081 tcp:8081
maestro --device emulator-5554 test e2e/ --exclude-tags=live
```
