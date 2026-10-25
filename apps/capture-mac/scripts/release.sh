#!/bin/bash
set -euo pipefail
: "${CAPTURE_VERSION:?Set an explicit CAPTURE_VERSION=MAJOR.MINOR.PATCH for a release.}"
: "${SPARKLE_PUBLIC_ED_KEY:?Set SPARKLE_PUBLIC_ED_KEY before building a release.}"
: "${SPARKLE_PRIVATE_KEY:?Set SPARKLE_PRIVATE_KEY before releasing.}"
: "${AZURE_STORAGE_CONNECTION_STRING:?Set AZURE_STORAGE_CONNECTION_STRING before releasing.}"
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
capture_require_command az

"$CAPTURE_SCRIPTS_DIR/build-app.sh"
"$CAPTURE_SCRIPTS_DIR/sign.sh"
"$CAPTURE_SCRIPTS_DIR/notarize.sh" app
"$CAPTURE_SCRIPTS_DIR/make-dmg.sh"
"$CAPTURE_SCRIPTS_DIR/notarize.sh" dmg
"$CAPTURE_SCRIPTS_DIR/publish.sh"
