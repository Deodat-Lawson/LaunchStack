#!/bin/bash
# Shared by the executable packaging entrypoints; not an entrypoint itself.

CAPTURE_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CAPTURE_APP_DIR="$(cd -- "$CAPTURE_SCRIPTS_DIR/.." && pwd)"
CAPTURE_REPO_ROOT="$(cd -- "$CAPTURE_APP_DIR/../.." && pwd)"
CAPTURE_VERSION="${CAPTURE_VERSION:-0.1.0}"
CAPTURE_SIGN_IDENTITY="${CAPTURE_SIGN_IDENTITY:--}"
CAPTURE_BUILD_DIR="${CAPTURE_BUILD_DIR:-$CAPTURE_REPO_ROOT/dist/capture-mac}"
CAPTURE_CACHE_DIR="${CAPTURE_CACHE_DIR:-$CAPTURE_REPO_ROOT/.cache/capture-mac}"
CAPTURE_SPARKLE_VERSION=2.8.1

capture_die() {
    printf 'Capture: %s\n' "$*" >&2
    exit 1
}

if [[ ! "$CAPTURE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    capture_die 'CAPTURE_VERSION must be MAJOR.MINOR.PATCH (for example 0.1.0).'
fi

# Resolve relative overrides against the checkout, regardless of the caller's cwd.
[[ "$CAPTURE_BUILD_DIR" = /* ]] || CAPTURE_BUILD_DIR="$CAPTURE_REPO_ROOT/$CAPTURE_BUILD_DIR"
[[ "$CAPTURE_CACHE_DIR" = /* ]] || CAPTURE_CACHE_DIR="$CAPTURE_REPO_ROOT/$CAPTURE_CACHE_DIR"
CAPTURE_APP_BUNDLE="$CAPTURE_BUILD_DIR/LaunchStack Capture.app"
CAPTURE_ARTIFACT_STEM="LaunchStack-Capture-$CAPTURE_VERSION-arm64"
CAPTURE_DMG_PATH="$CAPTURE_BUILD_DIR/$CAPTURE_ARTIFACT_STEM.dmg"
CAPTURE_ZIP_PATH="$CAPTURE_BUILD_DIR/$CAPTURE_ARTIFACT_STEM.zip"
export CAPTURE_VERSION CAPTURE_SIGN_IDENTITY CAPTURE_BUILD_DIR CAPTURE_CACHE_DIR

capture_require_macos() {
    [[ "$(uname -s)" = Darwin && "$(uname -m)" = arm64 ]] ||
        capture_die 'Packaging requires an Apple-silicon Mac with Xcode command-line tools.'
}

capture_require_command() {
    command -v "$1" >/dev/null 2>&1 || capture_die "Required command not found: $1"
}

capture_require_app() {
    [[ -x "$CAPTURE_APP_BUNDLE/Contents/MacOS/LaunchStackCapture" ]] ||
        capture_die "App not built; run $CAPTURE_SCRIPTS_DIR/build-app.sh first."
    local actual_version
    actual_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$CAPTURE_APP_BUNDLE/Contents/Info.plist")"
    [[ "$actual_version" = "$CAPTURE_VERSION" ]] ||
        capture_die "App version $actual_version does not match CAPTURE_VERSION=$CAPTURE_VERSION; rebuild it."
}

capture_require_app_update_key() {
    local app_key
    app_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$CAPTURE_APP_BUNDLE/Contents/Info.plist" 2>/dev/null || true)"
    [[ -n "$app_key" ]] || capture_die 'Production signing/publishing requires an app built with SPARKLE_PUBLIC_ED_KEY.'
    if [[ -n "${SPARKLE_PUBLIC_ED_KEY:-}" && "$app_key" != "$SPARKLE_PUBLIC_ED_KEY" ]]; then
        capture_die 'SPARKLE_PUBLIC_ED_KEY differs from the built app; rebuild before signing/publishing.'
    fi
}

capture_sparkle_root() {
    local candidate root version
    # SwiftPM extracts both the xcframework and its sibling bin/ tools from the
    # pinned binary artifact. Do not fetch tools from a separate/latest release.
    for candidate in "$CAPTURE_APP_DIR"/.build/artifacts/*/*/Sparkle.xcframework; do
        [[ -d "$candidate" ]] || continue
        root="${candidate%/Sparkle.xcframework}"
        [[ -x "$root/bin/sign_update" && -x "$root/bin/generate_appcast" ]] || continue
        version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$candidate/macos-arm64_x86_64/Sparkle.framework/Resources/Info.plist")"
        [[ "$version" = "$CAPTURE_SPARKLE_VERSION" ]] ||
            capture_die "Expected Sparkle $CAPTURE_SPARKLE_VERSION, found $version; update the package and packaging pin together."
        printf '%s\n' "$root"
        return
    done
    capture_die 'Pinned Sparkle SwiftPM artifact/tools missing; run build-app.sh first.'
}

capture_codesign() {
    local target="$1"
    shift
    local timestamp=(--timestamp)
    [[ "$CAPTURE_SIGN_IDENTITY" != - ]] || timestamp=(--timestamp=none)
    /usr/bin/codesign --force --sign "$CAPTURE_SIGN_IDENTITY" "${timestamp[@]}" "$@" "$target"
}

capture_has_notary_credentials() {
    [[ -n "${CAPTURE_NOTARY_KEY_ID:-}" && -n "${CAPTURE_NOTARY_ISSUER:-}" && -n "${CAPTURE_NOTARY_KEY_PATH:-}" ]]
}
