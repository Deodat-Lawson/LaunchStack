#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
kind="${1:-app}"
[[ $# -le 1 && ( "$kind" = app || "$kind" = dmg ) ]] || capture_die 'Usage: notarize.sh [app|dmg]'
if ! capture_has_notary_credentials; then
    printf 'Skipping %s notarization: set all of CAPTURE_NOTARY_KEY_ID, CAPTURE_NOTARY_ISSUER, and CAPTURE_NOTARY_KEY_PATH to enable it.\n' "$kind"
    exit 0
fi
[[ "$CAPTURE_SIGN_IDENTITY" != - ]] || capture_die 'Apple notarization requires a Developer ID Application CAPTURE_SIGN_IDENTITY, not ad-hoc signing.'
[[ -f "$CAPTURE_NOTARY_KEY_PATH" ]] || capture_die "Notary key not found: $CAPTURE_NOTARY_KEY_PATH"
capture_require_app
mkdir -p "$CAPTURE_BUILD_DIR/notarization"

if [[ "$kind" = app ]]; then
    target="$CAPTURE_APP_BUNDLE"
    submission="$CAPTURE_BUILD_DIR/notarization/$CAPTURE_ARTIFACT_STEM-app.zip"
    rm -f "$submission"
    /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$target" "$submission"
else
    target="$CAPTURE_DMG_PATH"
    [[ -f "$target" ]] || capture_die 'DMG not created; run make-dmg.sh after notarizing/stapling the app.'
    submission="$target"
fi
receipt="$CAPTURE_BUILD_DIR/notarization/$CAPTURE_ARTIFACT_STEM-$kind.json"
xcrun notarytool submit "$submission" --key "$CAPTURE_NOTARY_KEY_PATH" \
    --key-id "$CAPTURE_NOTARY_KEY_ID" --issuer "$CAPTURE_NOTARY_ISSUER" \
    --wait --output-format json > "$receipt"
status="$(/usr/bin/plutil -extract status raw -o - "$receipt")"
[[ "$status" = Accepted ]] || capture_die "Notarization was $status; inspect $receipt and use notarytool log for the submission details."
xcrun stapler staple "$target"
if [[ "$kind" = app ]]; then
    rm -f "$submission"
fi
printf 'Notarized and stapled %s.\n' "$target"
