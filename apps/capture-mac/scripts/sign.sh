#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
capture_require_app
if [[ "$CAPTURE_SIGN_IDENTITY" != - ]]; then
    capture_require_app_update_key
fi

framework="$CAPTURE_APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
framework_version="$framework/Versions/B"
# Sign every nested Sparkle component before its framework, then the bundled
# runtimes/helpers before the containing app. Never use codesign --deep to sign.
# Sparkle >=2.6 requires preserving the Downloader service's own entitlements.
capture_codesign "$framework_version/XPCServices/Downloader.xpc" --options runtime \
    --preserve-metadata=entitlements
for nested in \
    "$framework_version/XPCServices/Installer.xpc" \
    "$framework_version/Autoupdate" \
    "$framework_version/Updater.app"; do
    capture_codesign "$nested" --options runtime
done
capture_codesign "$framework" --options runtime
capture_codesign "$CAPTURE_APP_BUNDLE/Contents/Helpers/node" --options runtime \
    --entitlements "$CAPTURE_APP_DIR/Resources/node.entitlements.plist"
capture_codesign "$CAPTURE_APP_BUNDLE/Contents/Helpers/launchstack-system-audio" --options runtime \
    --entitlements "$CAPTURE_APP_DIR/Resources/helper.entitlements.plist"
app_entitlements="$CAPTURE_APP_DIR/Resources/app.entitlements.plist"
if [[ "$CAPTURE_SIGN_IDENTITY" = - ]]; then
    # Ad-hoc signatures have no shared Team ID for Sparkle library validation.
    app_entitlements="$CAPTURE_APP_DIR/Resources/app-adhoc.entitlements.plist"
fi
capture_codesign "$CAPTURE_APP_BUNDLE" --options runtime \
    --entitlements "$app_entitlements"
printf 'Signed %s with identity %s.\n' "$CAPTURE_APP_BUNDLE" "$CAPTURE_SIGN_IDENTITY"
