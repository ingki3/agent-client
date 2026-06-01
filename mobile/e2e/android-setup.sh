#!/usr/bin/env bash
# One-time per-emulator setup for running the Maestro e2e suite on Android.
#
# Two emulator-only quirks block the chat flows (01/02) on a stock Android image; this
# script neutralises both so the suite is a clean 4/4 (see e2e/README.md › Android):
#
#   1. Unicode input — Maestro can only type ASCII via `adb shell input text`
#      (maestro issue #146). The flows already type ASCII on Android (Korean on iOS),
#      so nothing to do here, but note: the reason ADBKeyboard is installed is #2.
#   2. Soft-keyboard occlusion — the stock Gboard floats over the chat composer and
#      covers the `chatSend` button, so Maestro can't tap it ("Element not found:
#      chatSend"). ADBKeyboard is a no-UI IME: it accepts text over a broadcast and
#      shows no on-screen keyboard, so the composer + send button stay reachable.
#
# ADBKeyboard.apk (17 KB, github.com/senzhk/ADBKeyBoard) is vendored under e2e/vendor/
# so this is offline + reproducible.
#
# Usage:  ./e2e/android-setup.sh [emulator-serial]   (default: emulator-5554)
set -euo pipefail

SERIAL="${1:-emulator-5554}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK="$HERE/vendor/ADBKeyboard.apk"
IME="com.android.adbkeyboard/.AdbIME"

echo "▸ target device: $SERIAL"
adb -s "$SERIAL" get-state >/dev/null

if ! adb -s "$SERIAL" shell pm list packages | grep -q "com.android.adbkeyboard"; then
  echo "▸ installing ADBKeyboard ($APK)"
  adb -s "$SERIAL" install -r "$APK"
else
  echo "▸ ADBKeyboard already installed"
fi

echo "▸ enabling + selecting ADBKeyboard IME"
adb -s "$SERIAL" shell ime enable "$IME"
adb -s "$SERIAL" shell ime set "$IME"

# Stop the "Try out your stylus" onboarding popup that can steal focus on Pixel images.
adb -s "$SERIAL" shell settings put secure stylus_handwriting_enabled 0 || true

echo "▸ active IME: $(adb -s "$SERIAL" shell settings get secure default_input_method)"
echo "✅ ready — run:  maestro --device $SERIAL test e2e/ --exclude-tags=live"
echo "   (to restore the normal keyboard later:  adb -s $SERIAL shell ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME)"
