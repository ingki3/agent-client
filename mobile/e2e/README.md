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

**Verified 4/4 green** on `emulator-5554` (Pixel_10_Pro, Android 17, 16 KB-page image),
Maestro 2.6.0, after the one-time setup below. Last clean run:

```
[Passed] 04-friend-delete   [Passed] 05-logout
[Passed] 01-signup-first-chat   [Passed] 02-markdown-and-trace
4/4 Flows Passed
```

### 1. Build & install a **Release** APK

Use Release, not debug: it's standalone (no Metro needed) and suppresses the RN LogBox
overlay (a debug-only overlay that otherwise covers the screen on any warning).

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # JBR 21
export ANDROID_HOME="$HOME/Library/Android/sdk"
$ANDROID_HOME/emulator/emulator -avd Pixel_10_Pro &        # boot an emulator
cd mobile/android && ./gradlew :app:assembleRelease        # ~3 min (first build ~19 min: NDK)
adb -s emulator-5554 install -r app/build/outputs/apk/release/app-release.apk
```

- **JDK** — Gradle 8.8 (RN 0.74) needs **JDK ≤ 22**; the system default JDK 25 fails with
  `Unsupported class file major version 69`. Use Android Studio's bundled JBR 21 (above).
- `applicationId` = `dev.simplist.agentclient.mockup` (same as iOS).
- The Release APK is signed with the debug key (see `android/app/build.gradle`), so it
  installs straight onto an emulator.

### 2. One-time emulator setup, then run

```bash
cd mobile
./e2e/android-setup.sh                                     # installs ADBKeyboard, sets IME
maestro --device emulator-5554 test e2e/ --exclude-tags=live
```

`android-setup.sh` is idempotent and offline (the 17 KB ADBKeyboard.apk is vendored under
`e2e/vendor/`). It survives `clearState` and app reinstalls — run it once per emulator.

### Why the extra setup (Android-only gotchas)

These are emulator/tooling limits, **not app bugs** — the app handles all of them correctly
for a real user. iOS needs none of this.

- **Maestro can't type non-ASCII on Android** (`adb shell input text` is ASCII-only —
  [maestro #146](https://github.com/mobile-dev-inc/maestro/issues/146)). Flows 01/02 type
  Korean on iOS and an ASCII string on Android via `when: { platform: ... }`. The mock reply
  branches on message *length*, not content, so both paths hit the same send→reply→trace
  path; the Korean reply rendering is still asserted on Android.
- **Soft keyboard covers `chatSend`.** The stock Gboard floats over the composer, so Maestro
  reports `Element not found: chatSend`. **ADBKeyboard** (installed by the setup script) is a
  no-UI IME — it accepts text over a broadcast and shows no on-screen keyboard, so the
  composer and send button stay tappable. This is the key fix; without it 01/02 fail.
- **Long markdown reply scrolls off-screen.** The rich reply is taller than the viewport and
  the list doesn't auto-scroll to its end, so 02 uses `scrollUntilVisible` (not `assertVisible`)
  to reach the GFM blockquote and the trace chip.
- **16 KB "Android App Compatibility" dialog.** This image uses a 16 KB-page system image and
  RN 0.74's `.so` libs aren't 16 KB-aligned (fixable only by upgrading RN), so the OS shows
  this dialog on every fresh launch — `clearState` resets its "Don't Show Again". The login
  subflow dismisses it by tapping `android:id/button1` ("Don't Show Again"); a no-op on iOS /
  non-16 KB images.
- **"Try out your stylus" popup** (Pixel images) — the setup script disables it via
  `settings put secure stylus_handwriting_enabled 0`.

> iOS remains 4/4. The 01/02 edits are platform-guarded, so the iOS path (Korean input +
> assertions) is unchanged; only the Android branch was added.

> The flows assume `expo.extra.relayBase = null` (the default — relay/push is opt-in). With a
> relay configured, mock-buddy chat flows (01/02) behave differently, so test the relay path
> separately.

> The flows assume `expo.extra.relayBase = null` (the default — relay/push is opt-in). With a
> relay configured, mock-buddy chat flows (01/02) behave differently, so test the relay path
> separately.
