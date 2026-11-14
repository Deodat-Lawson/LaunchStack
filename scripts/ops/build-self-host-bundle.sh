#!/usr/bin/env bash
# Assemble the self-host release bundle.
#
#   scripts/ops/build-self-host-bundle.sh [version] [outdir]
#
#   version  what the bundle's VERSION file says, e.g. 2.0.0 (a leading "v" is
#            dropped) or "edge". Default: edge.
#   outdir   where launchstack-self-host.tar.gz is written. Default: build/self-host/
#            under the repository root (git-ignored).
#
# The tarball unpacks, with no top-level directory, to exactly what the
# installer lays down in LAUNCHSTACK_HOME:
#
#   compose.yml       deploy/compose.yml
#   docker/           every file compose.yml mounts, copied from docker/
#   bin/launchstack   deploy/launchstack (the CLI)
#   VERSION           one line
#
# The repository's docker/ files are the single source of truth: the list of
# what to copy is read out of compose.yml's own bind mounts, so a mount added
# there is bundled without touching this script, and one that points at a
# missing file fails the build instead of the install.
#
# apps/web/config is not bundled: the app and worker images carry it, and
# compose.yml does not mount it.
set -euo pipefail

VERSION="${1:-edge}"
VERSION="${VERSION#v}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${2:-$REPO_ROOT/build/self-host}"
COMPOSE="$REPO_ROOT/deploy/compose.yml"
CLI="$REPO_ROOT/deploy/launchstack"
BUNDLE_NAME="launchstack-self-host.tar.gz"

fail() {
  echo "build-self-host-bundle: $*" >&2
  exit 1
}

[ -f "$COMPOSE" ] || fail "missing $COMPOSE"
case "$VERSION" in
  "" | *[!A-Za-z0-9._-]*) fail "version '$VERSION' may only contain letters, digits, '.', '_' and '-'" ;;
esac

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/launchstack-bundle.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

cp "$COMPOSE" "$STAGE/compose.yml"

# Every `./docker/<path>` bind-mount source in compose.yml, once each.
MOUNTS="$(sed -n 's|^[[:space:]]*-[[:space:]]*\./\(docker/[^:[:space:]]*\):.*$|\1|p' "$COMPOSE" | sort -u)"
[ -n "$MOUNTS" ] || fail "found no ./docker/ mounts in deploy/compose.yml; has the mount syntax changed?"

while IFS= read -r rel; do
  src="$REPO_ROOT/$rel"
  [ -e "$src" ] || fail "compose.yml mounts ./$rel, which does not exist in the repository"
  mkdir -p "$STAGE/$(dirname "$rel")"
  # -p keeps the mode: seaweedfs-entrypoint.sh must stay executable.
  cp -Rp "$src" "$STAGE/$rel"
done <<EOF
$MOUNTS
EOF

mkdir -p "$STAGE/bin"
if [ -f "$CLI" ]; then
  cp "$CLI" "$STAGE/bin/launchstack"
  chmod 755 "$STAGE/bin/launchstack"
elif [ "${CI:-}" = "true" ]; then
  # A release without the CLI is not installable; only a local build may skip it.
  fail "missing $CLI"
else
  echo "build-self-host-bundle: warning: deploy/launchstack not found, bundle has no CLI" >&2
  rmdir "$STAGE/bin"
fi

printf '%s\n' "$VERSION" >"$STAGE/VERSION"

# Normalise modes so the bundle does not depend on the builder's umask.
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f ! -perm -u+x -exec chmod 644 {} +
find "$STAGE" -type f -perm -u+x -exec chmod 755 {} +

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# Fixed member order and no owner names, and no macOS metadata (AppleDouble
# `._*` members, xattr headers) that GNU tar on the target would warn about
# or unpack as stray files.
ENTRIES="compose.yml docker"
[ -d "$STAGE/bin" ] && ENTRIES="$ENTRIES bin"
ENTRIES="$ENTRIES VERSION"

TAR_FLAGS=""
if tar --version 2>/dev/null | grep -qi 'bsdtar'; then
  TAR_FLAGS="--no-xattrs --no-mac-metadata --uid 0 --gid 0 --uname root --gname root"
else
  TAR_FLAGS="--owner=0 --group=0 --numeric-owner"
fi

# shellcheck disable=SC2086  # ENTRIES and TAR_FLAGS are word lists on purpose
COPYFILE_DISABLE=1 tar -C "$STAGE" $TAR_FLAGS -czf "$OUT_DIR/$BUNDLE_NAME" $ENTRIES

echo "$OUT_DIR/$BUNDLE_NAME"
echo "  version: $VERSION"
tar -tzf "$OUT_DIR/$BUNDLE_NAME" | sed 's/^/  /'
