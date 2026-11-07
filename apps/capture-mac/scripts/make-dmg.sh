#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
capture_require_app

stage="$(mktemp -d "$CAPTURE_BUILD_DIR/.dmg.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
# The app must already be signed (and, for production, notarized/stapled). ditto
# preserves Sparkle's framework symlinks and the app's stapled ticket.
/usr/bin/ditto "$CAPTURE_APP_BUNDLE" "$stage/LaunchStack Capture.app"
ln -s /Applications "$stage/Applications"
/usr/bin/hdiutil create -volname 'LaunchStack Capture' -srcfolder "$stage" \
    -format UDZO -ov "$CAPTURE_DMG_PATH"
capture_codesign "$CAPTURE_DMG_PATH"
printf 'Created %s. Notarize/staple the DMG before publishing it.\n' "$CAPTURE_DMG_PATH"
