#!/usr/bin/env bash
# LaunchStack installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Deodat-Lawson/LaunchStack/main/deploy/install.sh | bash
#
# Needs Docker with Compose v2 (it does not install Docker). Downloads the
# self-host bundle (compose.yml, docker/, the `launchstack` CLI, VERSION),
# unpacks it into LAUNCHSTACK_HOME and links the CLI onto your PATH. It never
# touches an existing .env or backups/, so running it again is an upgrade of
# the bundle files only. Nothing is started: `launchstack setup` does that.
#
# Environment:
#   LAUNCHSTACK_HOME      install directory                (default ~/.launchstack)
#   LAUNCHSTACK_VERSION   a release (2.0.0), or `edge` for the main branch
#                         (default: the latest release that has a bundle,
#                         else edge)
#   LAUNCHSTACK_BUNDLE    path or URL of a launchstack-self-host.tar.gz to
#                         install instead of downloading one (offline use)
#   LAUNCHSTACK_BIN_DIR   where to link the CLI            (default: the first
#                         writable of ~/.local/bin, /usr/local/bin)
#   LAUNCHSTACK_NO_LINK   set to 1 to skip linking the CLI
#   LAUNCHSTACK_REPO      GitHub owner/name                (default Deodat-Lawson/LaunchStack)
#
# Everything is inside main(), called on the last line, so a download cut
# short cannot run half a script.

set -euo pipefail

LS_TMP=""

ls_cleanup() {
  if [ -n "$LS_TMP" ] && [ -d "$LS_TMP" ]; then rm -rf "$LS_TMP"; fi
  return 0
}

ls_say() {
  if [ "${LAUNCHSTACK_QUIET:-0}" != "1" ]; then printf '%s\n' "$*"; fi
}

ls_warn() { printf 'warning: %s\n' "$*" >&2; }

ls_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

ls_download() { # ls_download <url> <file>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    ls_die "curl or wget is needed to download LaunchStack."
  fi
}

ls_check_docker() {
  command -v docker >/dev/null 2>&1 ||
    ls_die "Docker is not installed. Install Docker Desktop or Docker Engine (https://docs.docker.com/get-docker/), then run this again."
  docker compose version >/dev/null 2>&1 ||
    ls_die "Docker Compose v2 is missing ('docker compose version' failed). Install the Compose plugin (https://docs.docker.com/compose/install/), then run this again."
  local v major minor
  v="$(docker compose version --short 2>/dev/null || true)"
  v="${v#v}"
  major="${v%%.*}"
  minor="${v#*.}"
  minor="${minor%%.*}"
  case "$major$minor" in
    "" | *[!0-9]*) ;;
    *)
      if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
        ls_die "Docker Compose $v is too old: LaunchStack needs 2.24 or newer. Update Docker (https://docs.docker.com/compose/install/), then run this again."
      fi
      ;;
  esac
  docker info >/dev/null 2>&1 ||
    ls_die "Docker is installed but its daemon is not reachable. Start Docker (on Linux: 'sudo systemctl start docker', and add your user to the 'docker' group: https://docs.docker.com/engine/install/linux-postinstall/), then run this again."
}

# Newest published release (not a draft or prerelease) that carries the
# bundle asset. Prints its tag, or nothing.
ls_latest_release_tag() { # ls_latest_release_tag <asset name>
  local json="$LS_TMP/releases.json"
  local api="${LAUNCHSTACK_API_URL:-https://api.github.com/repos/${LS_REPO}/releases?per_page=30}"
  ls_download "$api" "$json" 2>/dev/null || return 0
  tr ',' '\n' <"$json" | awk -v asset="$1" '
    /"tag_name"[[:space:]]*:/ {
      tag = $0
      sub(/.*"tag_name"[[:space:]]*:[[:space:]]*"/, "", tag)
      sub(/".*/, "", tag)
      skip = 0
    }
    /"(draft|prerelease)"[[:space:]]*:[[:space:]]*true/ { skip = 1 }
    index($0, "\"name\"") && index($0, "\"" asset "\"") {
      if (tag != "" && !skip) { print tag; exit }
    }
  '
}

# The main branch has no release asset: fetch the branch and let the
# repository's own bundle script assemble it, so the file list has one source.
ls_build_edge_bundle() { # ls_build_edge_bundle <output tarball>
  local ref="${LAUNCHSTACK_REF:-main}" src="$LS_TMP/src" out="$LS_TMP/edge-out"
  ls_say "Fetching the $ref branch of ${LS_REPO}..."
  ls_download "https://codeload.github.com/${LS_REPO}/tar.gz/refs/heads/${ref}" "$LS_TMP/src.tar.gz" ||
    ls_die "Could not download the $ref branch of ${LS_REPO}."
  mkdir -p "$src" "$out"
  tar -xzf "$LS_TMP/src.tar.gz" -C "$src" --strip-components 1
  [ -f "$src/scripts/ops/build-self-host-bundle.sh" ] ||
    ls_die "The $ref branch has no scripts/ops/build-self-host-bundle.sh; install a release instead (LAUNCHSTACK_VERSION=<version>)."
  bash "$src/scripts/ops/build-self-host-bundle.sh" edge "$out" >/dev/null
  [ -f "$out/$LS_ASSET" ] || ls_die "Building the bundle from the $ref branch produced no $LS_ASSET."
  mv "$out/$LS_ASSET" "$1"
}

ls_fetch_release_bundle() { # ls_fetch_release_bundle <version> <output tarball>
  local version="$1" out="$2" tag base
  base="${LAUNCHSTACK_DOWNLOAD_BASE:-https://github.com/${LS_REPO}/releases/download}"
  for tag in "v${version#v}" "${version#v}"; do
    if ls_download "$base/$tag/$LS_ASSET" "$out" 2>/dev/null; then return 0; fi
  done
  return 1
}

ls_pick_bin_dir() {
  local dir
  if [ -n "${LAUNCHSTACK_BIN_DIR:-}" ]; then
    printf '%s' "$LAUNCHSTACK_BIN_DIR"
    return 0
  fi
  for dir in "$HOME/.local/bin" "/usr/local/bin"; do
    if [ -d "$dir" ] && [ -w "$dir" ]; then
      printf '%s' "$dir"
      return 0
    fi
  done
  # Neither exists and is writable: ~/.local/bin is ours to create.
  if mkdir -p "$HOME/.local/bin" 2>/dev/null && [ -w "$HOME/.local/bin" ]; then
    printf '%s' "$HOME/.local/bin"
  fi
  return 0
}

ls_link_cli() { # ls_link_cli <install dir>
  local home_dir="$1" bin_dir link
  bin_dir="$(ls_pick_bin_dir)"
  if [ -z "$bin_dir" ]; then
    ls_warn "No writable directory to link the CLI into. Run it as: $home_dir/bin/launchstack"
    LS_CLI="$home_dir/bin/launchstack"
    return 0
  fi
  mkdir -p "$bin_dir" 2>/dev/null || true
  link="$bin_dir/launchstack"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    ls_warn "$link exists and is not a link to LaunchStack; leaving it alone. Run the CLI as: $home_dir/bin/launchstack"
    LS_CLI="$home_dir/bin/launchstack"
    return 0
  fi
  if ! ln -sf "$home_dir/bin/launchstack" "$link" 2>/dev/null; then
    ls_warn "Could not create $link. Run the CLI as: $home_dir/bin/launchstack"
    LS_CLI="$home_dir/bin/launchstack"
    return 0
  fi
  LS_CLI="launchstack"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *)
      ls_say ""
      ls_say "Note: $bin_dir is not on your PATH. Add it (for example, put"
      ls_say "  export PATH=\"$bin_dir:\$PATH\""
      ls_say "in your shell profile), or run the CLI as $link"
      LS_CLI="$link"
      ;;
  esac
}

main() {
  LS_REPO="${LAUNCHSTACK_REPO:-Deodat-Lawson/LaunchStack}"
  LS_ASSET="launchstack-self-host.tar.gz"
  LS_CLI="launchstack"
  local home_dir="${LAUNCHSTACK_HOME:-$HOME/.launchstack}"
  local version="${LAUNCHSTACK_VERSION:-}" bundle_src="${LAUNCHSTACK_BUNDLE:-}"
  local tarball bundle_dir bad installed

  command -v tar >/dev/null 2>&1 || ls_die "tar is needed to unpack LaunchStack."
  ls_check_docker

  LS_TMP="$(mktemp -d "${TMPDIR:-/tmp}/launchstack-install.XXXXXX")"
  trap ls_cleanup EXIT
  tarball="$LS_TMP/$LS_ASSET"
  bundle_dir="$LS_TMP/bundle"
  mkdir -p "$bundle_dir"

  if [ -n "$bundle_src" ]; then
    case "$bundle_src" in
      http://* | https://*)
        ls_say "Downloading $bundle_src..."
        ls_download "$bundle_src" "$tarball" || ls_die "Could not download $bundle_src"
        ;;
      *)
        [ -f "$bundle_src" ] || ls_die "LAUNCHSTACK_BUNDLE: no such file: $bundle_src"
        cp "$bundle_src" "$tarball"
        ;;
    esac
  else
    if [ -z "$version" ]; then
      version="$(ls_latest_release_tag "$LS_ASSET")"
      if [ -z "$version" ]; then
        ls_say "No release with a self-host bundle was found; installing the main branch (edge)."
        version="edge"
      fi
    fi
    if [ "$version" = "edge" ]; then
      ls_build_edge_bundle "$tarball"
    else
      ls_say "Downloading LaunchStack ${version#v}..."
      ls_fetch_release_bundle "$version" "$tarball" ||
        ls_die "Release '${version#v}' of ${LS_REPO} has no $LS_ASSET. See https://github.com/${LS_REPO}/releases, or use LAUNCHSTACK_VERSION=edge."
    fi
  fi

  # Refuse archive members that would land outside the unpack directory.
  bad="$(tar -tzf "$tarball" 2>/dev/null | grep -E '(^/|(^|/)\.\.(/|$))' || true)"
  [ -z "$bad" ] || ls_die "The bundle contains unsafe paths; not unpacking it."
  tar -xzf "$tarball" -C "$bundle_dir" || ls_die "The bundle is not a readable .tar.gz."
  for bad in compose.yml VERSION bin/launchstack; do
    [ -f "$bundle_dir/$bad" ] || ls_die "The bundle is incomplete: $bad is missing."
  done

  # The new release's own CLI lays the files down: it replaces compose.yml,
  # VERSION and bin/launchstack, merges docker/ (edited files are kept), and
  # leaves .env and backups/ alone.
  mkdir -p "$home_dir"
  LAUNCHSTACK_HOME="$home_dir" bash "$bundle_dir/bin/launchstack" _apply-bundle "$bundle_dir"
  installed="$(head -n 1 "$home_dir/VERSION")"

  if [ "${LAUNCHSTACK_NO_LINK:-0}" != "1" ]; then
    ls_link_cli "$home_dir"
  fi

  ls_say ""
  ls_say "LaunchStack $installed is installed in $home_dir"
  if [ -f "$home_dir/.env" ]; then
    ls_say "Your existing configuration (.env) was kept. Apply the new files with:"
    ls_say ""
    ls_say "  $LS_CLI restart"
  else
    ls_say "Next, answer a few questions and start it:"
    ls_say ""
    ls_say "  $LS_CLI setup"
  fi
}

main "$@"
