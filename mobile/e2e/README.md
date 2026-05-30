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

**App: works.** Builds, installs, and runs on a Pixel_7 emulator — renders the user-id
onboarding screen correctly (verified manually via screenshot + view hierarchy: app
process alive, correct screen, no crash, no require-cycle LogBox overlay after the
`f7cabaf` fix).

**Maestro suite on Android: NOT passing yet (0/4 as run).** Blocked by an emulator-only
issue, not an app bug — see below.

Build setup for this machine:

1. **JDK** — Gradle 8.8 (RN 0.74) needs **JDK ≤ 22**; the system default JDK 25 fails with
   `Unsupported class file major version 69`. Use Android Studio's bundled JBR 21.
2. **First build is slow (~19 min)** — downloads the NDK + compiles native code (not hung).
   Debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
$ANDROID_HOME/emulator/emulator -avd Pixel_7 -no-snapshot &   # boot an emulator
cd mobile && npx expo run:android                             # build + install (keep Metro up)
```

`applicationId` is `dev.simplist.agentclient.mockup` (same as iOS). Debug builds load JS
from Metro, so keep Metro on 8081 and tunnel it: `adb -s emulator-5554 reverse tcp:8081 tcp:8081`.

### Why the suite is blocked (known issue)

This Pixel_7 AVD uses a **16 KB-page system image**, and RN 0.74's native `.so` libs aren't
16 KB-aligned, so the OS shows a full-screen **"Android App Compatibility"** dialog on every
**fresh launch**. Each flow starts with `launchApp: { clearState: true }`, which resets the
"Don't Show Again" preference, so the dialog re-appears at the top of every flow and Maestro
can't see the app → all asserts fail.

To get the suite green on Android, do one of:
- Run on an AVD with a **non-16 KB** system image (the dialog never appears), or
- Add a `launchApp` `arguments`/`onLaunch` step (or a Maestro hook) that dismisses the
  compat dialog after each clearState, or
- Build a **16 KB-aligned** release (newer AGP/NDK with `android.experimental.enableNewResourceShrinker`
  + 16 KB page support) so the dialog isn't shown.

(On iOS the suite passes 4/4; the flows themselves and the testID mapping are fine — this is
purely the Android 16 KB-page emulator dialog.)
