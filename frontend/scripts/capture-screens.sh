#!/usr/bin/env bash
#
# Capture README / App Store screenshots from the iOS Simulator.
#
# Why Expo Go rather than a native build: every dependency in package.json ships
# inside Expo Go and there is no custom native code, so `expo run:ios` (and the
# CocoaPods install it needs) buys nothing here. On at least one machine the
# Homebrew CocoaPods is an x86_64 Ruby that hangs under Rosetta, which makes the
# native path actively worse.
#
#   1. Start a dev server for the device (not --web, which does not serve an
#      iOS bundle):
#
#        cd frontend && npx expo start --go --port 8082
#
#   2. Install Expo Go on the booted simulator, if it is not already there.
#      Get the matching client URL for the SDK from Expo's version manifest:
#
#        curl -s https://api.expo.dev/v2/versions/latest \
#          | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['sdkVersions']['57.0.0']['iosClientUrl'])"
#
#      then untar it and `xcrun simctl install booted "Expo Go.app"`.
#
#   3. Open the project:  xcrun simctl openurl booted "exp://127.0.0.1:8082"
#
#   4. Run this script.
#
# Navigation is manual by default — you drive the app, this captures on Enter.
# To automate taps as well, build the CGEvent driver alongside it:
#
#     xcrun swiftc -O scripts/siminput.swift -o /tmp/siminput
#
# and note the two things that bite:
#   * The Simulator forwards the hardware keyboard by *keycode* and ignores
#     keyboardSetUnicodeString, and it never sees the Command modifier — so no
#     Cmd+A, no Cmd+V. siminput.swift maps characters to real keycodes instead.
#   * RN ScrollViews ignore synthetic scroll-wheel events. Use `siminput drag`.
#
# Coordinate mapping, once Window > Point Accurate is set and Show Device Bezels
# is off: content origin is (window.x, window.y + 52) and one device point is one
# screen point, so a device point (px,py) is at (origin.x + px, origin.y + py).
#
set -euo pipefail

OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/docs/screenshots}"
DEVICE="${DEVICE:-booted}"
WIDTH="${WIDTH:-720}"   # downscale for the repo; 0 keeps native resolution

mkdir -p "$OUT_DIR"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <name> [name...]" >&2
  echo "example: $0 02-home 03-workouts 04-nutrition-today" >&2
  exit 64
fi

for name in "$@"; do
  read -r -p "Navigate to '$name', then press Enter to capture… "
  path="$OUT_DIR/$name.png"
  xcrun simctl io "$DEVICE" screenshot --type=png "$path"
  if [ "$WIDTH" -gt 0 ]; then
    sips --resampleWidth "$WIDTH" "$path" --out "$path" >/dev/null
  fi
  echo "captured $path"
done
