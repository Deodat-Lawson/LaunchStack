#!/bin/bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
capture_require_macos
capture_require_command pnpm
capture_require_command swift

if [[ -z "${SPARKLE_PUBLIC_ED_KEY:-}" && "$CAPTURE_SIGN_IDENTITY" != - ]]; then
    capture_die 'Set SPARKLE_PUBLIC_ED_KEY before building a production-signed app.'
fi
if [[ -n "${SPARKLE_PUBLIC_ED_KEY:-}" && ! "$SPARKLE_PUBLIC_ED_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    capture_die 'SPARKLE_PUBLIC_ED_KEY must be a base64-encoded 32-byte Ed25519 public key.'
fi

# The runtime is deliberately independent of the Node used by pnpm on the host.
# Pin the official checksum too, so a cached/replaced SHASUMS file cannot silently
# select a different runtime for this release.
NODE_VERSION=24.14.0
NODE_SHA256=a1a54f46a750d2523d628d924aab61758a51c9dad3e0238beb14141be9615dd3
node_name="node-v$NODE_VERSION-darwin-arm64"
node_archive="$node_name.tar.gz"
node_cache="$CAPTURE_CACHE_DIR/node-v$NODE_VERSION"
mkdir -p "$node_cache" "$CAPTURE_BUILD_DIR"

fetch_cached() {
    local url="$1" destination="$2"
    if [[ ! -f "$destination" ]]; then
        /usr/bin/curl --fail --location --silent --show-error "$url" --output "$destination.part"
        mv -f "$destination.part" "$destination"
    fi
}
fetch_cached "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" "$node_cache/SHASUMS256.txt"
fetch_cached "https://nodejs.org/dist/v$NODE_VERSION/$node_archive" "$node_cache/$node_archive"
expected_sha=''
while read -r checksum filename; do
    if [[ "$filename" = "$node_archive" ]]; then
        expected_sha="$checksum"
        break
    fi
done < "$node_cache/SHASUMS256.txt"
[[ "$expected_sha" = "$NODE_SHA256" ]] || capture_die 'Node SHASUMS256.txt does not match the pinned darwin-arm64 runtime.'
(
    cd -- "$node_cache"
    printf '%s  %s\n' "$expected_sha" "$node_archive" | /usr/bin/shasum -a 256 --check
)
# Re-extract the checked archive every build rather than trusting an old binary.
/usr/bin/tar -xzf "$node_cache/$node_archive" -C "$node_cache" "$node_name/bin/node" "$node_name/LICENSE"

(
    cd -- "$CAPTURE_REPO_ROOT"
    pnpm --filter @launchstack/call-worker build
)
helper_package="$CAPTURE_REPO_ROOT/apps/call-worker/native/system-audio-capture"
swift build --package-path "$helper_package" --configuration release --arch arm64 --product launchstack-system-audio
helper_bin_dir="$(swift build --package-path "$helper_package" --configuration release --arch arm64 --show-bin-path)"
swift build --package-path "$CAPTURE_APP_DIR" --configuration release --arch arm64 --product LaunchStackCapture
app_bin_dir="$(swift build --package-path "$CAPTURE_APP_DIR" --configuration release --arch arm64 --show-bin-path)"
sparkle_root="$(capture_sparkle_root)"

# Replace only this generated bundle; keep previously produced release artifacts.
rm -rf "$CAPTURE_APP_BUNDLE"
mkdir -p "$CAPTURE_APP_BUNDLE/Contents/MacOS" "$CAPTURE_APP_BUNDLE/Contents/Helpers" \
    "$CAPTURE_APP_BUNDLE/Contents/Resources/worker" "$CAPTURE_APP_BUNDLE/Contents/Resources/licenses" \
    "$CAPTURE_APP_BUNDLE/Contents/Frameworks"
cp "$app_bin_dir/LaunchStackCapture" "$CAPTURE_APP_BUNDLE/Contents/MacOS/LaunchStackCapture"
cp "$node_cache/$node_name/bin/node" "$CAPTURE_APP_BUNDLE/Contents/Helpers/node"
cp "$helper_bin_dir/launchstack-system-audio" "$CAPTURE_APP_BUNDLE/Contents/Helpers/launchstack-system-audio"
cp "$CAPTURE_REPO_ROOT/apps/call-worker/dist/main.js" "$CAPTURE_APP_BUNDLE/Contents/Resources/worker/main.js"
/usr/bin/ditto "$sparkle_root/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework" "$CAPTURE_APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
# The pinned Sparkle distribution is universal, even though the app/helper are
# built for arm64. Keep only arm64 in every bundled Mach-O before re-signing.
# Traverse regular files so framework symlinks remain intact.
while IFS= read -r -d '' binary; do
    [[ "$(/usr/bin/file -b "$binary")" = *Mach-O* ]] || continue
    architectures="$(/usr/bin/lipo -archs "$binary")"
    [[ "$architectures" != arm64 ]] || continue
    case " $architectures " in
        *" arm64 "*) ;;
        *) capture_die "Bundled Mach-O has no arm64 slice: $binary ($architectures)" ;;
    esac
    mode="$(/usr/bin/stat -f '%Lp' "$binary")"
    /usr/bin/lipo "$binary" -thin arm64 -output "$binary.arm64"
    chmod "$mode" "$binary.arm64"
    mv -f "$binary.arm64" "$binary"
done < <(/usr/bin/find "$CAPTURE_APP_BUNDLE" -type f -print0)
cp "$CAPTURE_APP_DIR/Resources/Info.plist" "$CAPTURE_APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $CAPTURE_VERSION" "$CAPTURE_APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $CAPTURE_VERSION" "$CAPTURE_APP_BUNDLE/Contents/Info.plist"
if [[ -n "${SPARKLE_PUBLIC_ED_KEY:-}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $SPARKLE_PUBLIC_ED_KEY" "$CAPTURE_APP_BUNDLE/Contents/Info.plist"
else
    /usr/libexec/PlistBuddy -c 'Delete :SUPublicEDKey' "$CAPTURE_APP_BUNDLE/Contents/Info.plist"
    printf 'Development build: no Sparkle public key; signed update publishing is unavailable.\n'
fi
cp "$node_cache/$node_name/LICENSE" "$CAPTURE_APP_BUNDLE/Contents/Resources/licenses/Node.txt"
cp "$sparkle_root/LICENSE" "$CAPTURE_APP_BUNDLE/Contents/Resources/licenses/Sparkle.txt"
cp "$CAPTURE_REPO_ROOT/LICENSE" "$CAPTURE_APP_BUNDLE/Contents/Resources/licenses/LaunchStack.txt"
cp "$CAPTURE_REPO_ROOT/THIRD_PARTY_LICENSES.md" "$CAPTURE_APP_BUNDLE/Contents/Resources/licenses/ThirdParty.md"
# Package.swift links @executable_path/../Frameworks as the app's Sparkle rpath.
printf 'Built %s (version %s, arm64). Run sign.sh before opening it.\n' "$CAPTURE_APP_BUNDLE" "$CAPTURE_VERSION"
