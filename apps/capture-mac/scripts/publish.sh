#!/bin/bash
set -euo pipefail
: "${CAPTURE_VERSION:?Set an explicit CAPTURE_VERSION=MAJOR.MINOR.PATCH before publishing.}"
: "${SPARKLE_PUBLIC_ED_KEY:?Set SPARKLE_PUBLIC_ED_KEY to the production app update public key.}"
: "${SPARKLE_PRIVATE_KEY:?Set SPARKLE_PRIVATE_KEY to the contents of the exported Sparkle private key.}"
: "${AZURE_STORAGE_CONNECTION_STRING:?Set AZURE_STORAGE_CONNECTION_STRING for the private capture-app container.}"
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
capture_require_command az
capture_require_app
capture_require_app_update_key
[[ -f "$CAPTURE_DMG_PATH" ]] || capture_die 'Release DMG missing; run make-dmg.sh and notarize.sh dmg first.'
sparkle_root="$(capture_sparkle_root)"

stage="$(mktemp -d "$CAPTURE_BUILD_DIR/.publish.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
archive="$stage/$CAPTURE_ARTIFACT_STEM.zip"
# Create the Sparkle archive only after the app's notarization ticket is stapled.
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$CAPTURE_APP_BUNDLE" "$archive"
# Sparkle signs from stdin; no private key is placed in argv or a temporary file.
# Use a syntactically absolute generation URL, then replace only its reserved
# origin below. The authenticated web route materializes the request origin so
# the same private release can serve every LaunchStack deployment.
printf '%s\n' "$SPARKLE_PRIVATE_KEY" | "$sparkle_root/bin/generate_appcast" \
    --ed-key-file - --maximum-deltas 0 \
    --download-url-prefix 'https://capture.launchstack.invalid/api/call-notes/devices/updates/' \
    -o "$stage/appcast.xml" "$stage"
appcast="$(< "$stage/appcast.xml")"
appcast="${appcast//https:\/\/capture.launchstack.invalid/__LAUNCHSTACK_ORIGIN__}"
printf '%s\n' "$appcast" > "$stage/appcast.xml"
enclosure_url="$(/usr/bin/xmllint --xpath 'string(//*[local-name()="enclosure"]/@url)' "$stage/appcast.xml")"
[[ "$enclosure_url" = "__LAUNCHSTACK_ORIGIN__/api/call-notes/devices/updates/$CAPTURE_ARTIFACT_STEM.zip" ]] ||
    capture_die 'Generated appcast does not use the authenticated deployment-relative update route.'
signature="$(/usr/bin/xmllint --xpath 'string(//*[local-name()="enclosure"]/@*[local-name()="edSignature"])' "$stage/appcast.xml")"
[[ -n "$signature" ]] || capture_die 'Sparkle did not sign the archive; check that the private key matches SUPublicEDKey.'
printf '%s\n' "$SPARKLE_PRIVATE_KEY" | "$sparkle_root/bin/sign_update" \
    --ed-key-file - --verify "$archive" "$signature"
cp "$archive" "$CAPTURE_ZIP_PATH"
cp "$stage/appcast.xml" "$CAPTURE_BUILD_DIR/appcast.xml"
printf '{"version":"%s","dmg":"releases/%s/%s.dmg"}\n' \
    "$CAPTURE_VERSION" "$CAPTURE_VERSION" "$CAPTURE_ARTIFACT_STEM" > "$CAPTURE_BUILD_DIR/latest.json"

# Azure CLI reads AZURE_STORAGE_CONNECTION_STRING from the environment. Never
# pass the connection string in process arguments or expose public blob URLs.
az storage container create --name capture-app --public-access off --only-show-errors --output none
az storage container set-permission --name capture-app --public-access off --only-show-errors --output none
az storage blob upload --container-name capture-app \
    --name "releases/$CAPTURE_VERSION/$CAPTURE_ARTIFACT_STEM.zip" --file "$CAPTURE_ZIP_PATH" \
    --content-type application/zip --content-cache-control 'private, no-cache' \
    --overwrite true --only-show-errors --output none
az storage blob upload --container-name capture-app \
    --name "releases/$CAPTURE_VERSION/$CAPTURE_ARTIFACT_STEM.dmg" --file "$CAPTURE_DMG_PATH" \
    --content-type application/x-apple-diskimage --content-cache-control 'private, no-cache' \
    --overwrite true --only-show-errors --output none
az storage blob upload --container-name capture-app \
    --name appcast.xml --file "$CAPTURE_BUILD_DIR/appcast.xml" \
    --content-type application/xml --content-cache-control 'private, no-store' \
    --overwrite true --only-show-errors --output none
# This is the publication pointer: upload LAST, only after every artifact/feed.
az storage blob upload --container-name capture-app \
    --name latest.json --file "$CAPTURE_BUILD_DIR/latest.json" \
    --content-type application/json --content-cache-control 'private, no-store' \
    --overwrite true --only-show-errors --output none
printf 'Published Capture %s to the private capture-app container (latest.json last).\n' "$CAPTURE_VERSION"
