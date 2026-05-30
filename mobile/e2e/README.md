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

**App: works** (verified by hand — builds, installs, renders the user-id onboarding and the
mock-buddy chat with markdown). **Maestro suite: not reliably green on this emulator yet.**
Best observed was 2/4 (04, 05 pass; 01, 02 flaky). The blockers are all emulator-environment
dialogs/timing, not app bugs — see below. Don't trust an Android "all-green" claim until a
clean `4/4 Flows Passed` is actually observed here.

Build setup for this machine:

1. **JDK** — Gradle 8.8 (RN 0.74) needs **JDK ≤ 22**; the system default JDK 25 fails with
   `Unsupported class file major version 69`. Use Android Studio's bundled JBR 21.
2. **First build is slow (~19 min)** — downloads the NDK + compiles native code (not hung).
   Debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk` (reinstall with
   `adb install -r` instead of rebuilding if the emulator is wiped).

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
$ANDROID_HOME/emulator/emulator -avd Pixel_7 -no-snapshot &   # boot an emulator
cd mobile && npx expo run:android                             # build + install (keep Metro up)
```

`applicationId` is `dev.simplist.agentclient.mockup` (same as iOS). Debug builds load JS
from Metro, so keep Metro on 8081 and tunnel it, then run the suite:

```bash
adb -s emulator-5554 reverse tcp:8081 tcp:8081   # + tcp:8787 if testing the relay
maestro --device emulator-5554 test e2e/ --exclude-tags=live
```

### Emulator-only blockers (why the suite is flaky here)

- **16 KB page-size dialog** — this Pixel_7 AVD uses a 16 KB-page system image and RN 0.74's
  `.so` libs aren't 16 KB-aligned, so the OS shows an "Android App Compatibility" dialog on
  every fresh launch (and `clearState` resets its "Don't Show Again"). The login subflow
  dismisses it with an `optional` `tapOn "Don.t Show Again"` — a no-op on iOS / non-16 KB.
- **"Try out your stylus" dialog** — a Pixel system popup that intermittently appears over the
  chat when a text field is focused, covering it (breaks 01/02). Not yet handled.
- **LogBox overlay** (debug only) — the app must be warning-free (e.g. no require cycles, see
  `f7cabaf`) or LogBox covers the screen. Release/iOS suppresses LogBox.

The clean fix is to run e2e on a **plain (non-Pixel, non-16 KB) AVD** — none of these dialogs
appear there. The flows and the testID→`resource-id` mapping are correct (4/4 on iOS).

> The flows assume `expo.extra.relayBase = null` (the default — relay/push is opt-in). With a
> relay configured, mock-buddy chat flows (01/02) behave differently, so test the relay path
> separately.
