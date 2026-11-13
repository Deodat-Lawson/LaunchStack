#!/usr/bin/env bash
# Tests for deploy/launchstack and deploy/install.sh.
#
#   bash deploy/tests/run.sh            # every test
#   bash deploy/tests/run.sh setup      # only tests whose name contains "setup"
#
# Plain bash (bats is not a dependency). No Docker is touched: fake-docker.sh
# is put on PATH as `docker` and records every call, and each test gets its
# own temporary HOME and LAUNCHSTACK_HOME. The scripts under test run with
# the same bash that runs this file, so `/bin/bash deploy/tests/run.sh` on
# macOS exercises them on bash 3.2.

# Single-quoted `bash -c` bodies and literal `$` test values are deliberate.
# shellcheck disable=SC2016

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$TESTS_DIR/.." && pwd)"
CLI="$DEPLOY_DIR/launchstack"
INSTALLER="$DEPLOY_DIR/install.sh"
BASH_BIN="${BASH:-bash}"
FILTER="${1:-}"

# Nothing from the caller's shell may leak into the scripts under test.
for v in $(env | sed -n 's/^\(LAUNCHSTACK_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset VISUAL EDITOR

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/launchstack-tests.XXXXXX")"
# Physical path: macOS's TMPDIR sits behind the /var -> /private/var symlink
# (and often ends in a slash), and the CLI reports its home resolved.
ROOT="$(cd "$ROOT" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

# `docker` is the shim; `bash` is the bash running this file, so install.sh's
# nested `bash …` calls stay on the version under test.
SHIM_BIN="$ROOT/shim-bin"
mkdir -p "$SHIM_BIN"
cp "$TESTS_DIR/fake-docker.sh" "$SHIM_BIN/docker"
chmod +x "$SHIM_BIN/docker"
ln -s "$BASH_BIN" "$SHIM_BIN/bash"
export PATH="$SHIM_BIN:$PATH"
export NO_COLOR=1
export LAUNCHSTACK_HEALTH_INTERVAL=0

PASS=0
FAIL=0
CURRENT=""
OUT=""
RC=0

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL [%s] %s\n' "$CURRENT" "$*"
}
pass() { PASS=$((PASS + 1)); }

run() { # run <command...>  → OUT (stdout+stderr) and RC
  OUT="$("$@" 2>&1)"
  RC=$?
}

assert_rc() { # assert_rc <expected> <what>
  if [ "$RC" = "$1" ]; then pass; else fail "$2: exit code $RC, expected $1. Output: $OUT"; fi
}
assert_rc_nonzero() {
  if [ "$RC" != "0" ]; then pass; else fail "$1: exit code 0, expected a failure. Output: $OUT"; fi
}
assert_eq() { # assert_eq <actual> <expected> <what>
  if [ "$1" = "$2" ]; then pass; else fail "$3: got '$1', expected '$2'"; fi
}
assert_ne() {
  if [ "$1" != "$2" ]; then pass; else fail "$3: got '$1', which must differ"; fi
}
assert_contains() { # assert_contains <haystack> <needle> <what>
  case "$1" in
    *"$2"*) pass ;;
    *) fail "$3: '$2' not found in: $1" ;;
  esac
}
assert_not_contains() {
  case "$1" in
    *"$2"*) fail "$3: '$2' must not appear in: $1" ;;
    *) pass ;;
  esac
}
assert_file() {
  if [ -f "$1" ]; then pass; else fail "missing file $1"; fi
}
assert_no_file() {
  if [ -e "$1" ]; then fail "$1 exists and should not"; else pass; fi
}
assert_match() { # assert_match <value> <ERE> <what>
  if printf '%s' "$1" | grep -Eq "$2"; then pass; else fail "$3: '$1' does not match $2"; fi
}

# GNU stat first: its -f means "filesystem", prints a block and fails, so
# trying the BSD form first would prepend that block to the answer on Linux.
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
envval() { sed -n "s/^$2=//p" "$1" | tail -n 1; } # envval <file> <KEY>
log_has() { grep -q -- "$1" "$FAKE_DOCKER_LOG"; }
log_line_of() { grep -n -- "$1" "$FAKE_DOCKER_LOG" | head -n 1 | cut -d: -f1; }
assert_logged() {
  if log_has "$1"; then pass; else fail "$2: no docker call matching '$1'. Calls: $(cat "$FAKE_DOCKER_LOG")"; fi
}
assert_not_logged() {
  if log_has "$1"; then fail "$2: unexpected docker call matching '$1'"; else pass; fi
}

# make_bundle <dir> <version> [filer.toml content]  → an unpacked bundle
make_bundle() {
  mkdir -p "$1/bin" "$1/docker/searxng"
  printf 'name: launchstack\nservices: {}\n# bundle %s\n' "$2" >"$1/compose.yml"
  printf '%s\n' "${3:-filer v1}" >"$1/docker/filer.toml"
  printf 'settings %s\n' "$2" >"$1/docker/searxng/settings.yml"
  cp "$CLI" "$1/bin/launchstack"
  chmod 755 "$1/bin/launchstack"
  printf '%s\n' "$2" >"$1/VERSION"
}

# make_tarball <bundle dir> <out.tar.gz>
make_tarball() {
  COPYFILE_DISABLE=1 tar -C "$1" -czf "$2" compose.yml docker bin VERSION
}

# fresh <name> [version]  → a new HOME + installed LAUNCHSTACK_HOME + empty docker log
fresh() {
  local base="$ROOT/$1-$RANDOM"
  mkdir -p "$base/home"
  export HOME="$base/home"
  export LAUNCHSTACK_HOME="$base/install"
  export FAKE_DOCKER_LOG="$base/docker.log"
  export FAKE_DOCKER_STATE="$base/state"
  mkdir -p "$FAKE_DOCKER_STATE"
  : >"$FAKE_DOCKER_LOG"
  unset FAKE_DOCKER_INFO_RC FAKE_DOCKER_PREFLIGHT_RC FAKE_DOCKER_DOWN FAKE_DOCKER_UNHEALTHY_VERSION
  unset LAUNCHSTACK_HEALTH_TIMEOUT LAUNCHSTACK_BUNDLE LAUNCHSTACK_INSTALLER LAUNCHSTACK_BIN_DIR
  BASE="$base"
  make_bundle "$base/bundle" "${2:-1.2.3}"
  "$BASH_BIN" "$CLI" _apply-bundle "$base/bundle" >/dev/null 2>&1 || fail "could not lay down a test install"
  ENVF="$LAUNCHSTACK_HOME/.env"
}

cli() { "$BASH_BIN" "$CLI" "$@"; }

# setup_local_gemini  → a finished non-interactive local + Gemini setup
setup_local_gemini() {
  run env LAUNCHSTACK_SETUP_CHAT_PROVIDER=gemini LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 \
    "$BASH_BIN" "$CLI" setup --non-interactive
}

GENERATED_SECRETS="POSTGRES_PASSWORD BETTER_AUTH_SECRET FILE_ACCESS_TOKEN_SECRET EMBEDDING_SECRETS_KEY S3_ACCESS_KEY S3_SECRET_KEY ADEU_SERVICE_API_KEY DOCUMENT_CONVERTER_API_KEY TRANSCRIPTION_SERVICE_API_KEY GOTENBERG_SERVICE_PASSWORD INNGEST_EVENT_KEY INNGEST_SIGNING_KEY SEARXNG_SECRET"
CONTRACT_KEYS="LAUNCHSTACK_VERSION DOMAIN ACME_EMAIL LAUNCHSTACK_HTTP_PORT LAUNCHSTACK_FILES_PORT LAUNCHSTACK_BIND COMPOSE_PROFILES BETTER_AUTH_URL GOOGLE_AI_API_KEY CHAT_BASE_URL CHAT_API_KEY CHAT_MODELS_CONFIG EMBEDDING_API_BASE_URL EMBEDDING_API_KEY EMBEDDING_MODEL EMBEDDING_INDEX $GENERATED_SECRETS"

assert_env_complete() { # every contract key has a line; every secret has a value
  local k
  for k in $CONTRACT_KEYS; do
    if grep -q "^$k=" "$ENVF"; then pass; else fail "$k has no line in .env"; fi
  done
  for k in $GENERATED_SECRETS; do
    if [ -n "$(envval "$ENVF" "$k")" ]; then pass; else fail "$k is empty"; fi
  done
  assert_eq "$(file_mode "$ENVF")" "600" ".env mode"
  # One line per key: a duplicate would let two values disagree.
  assert_eq "$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$ENVF" | sort | uniq -d | tr '\n' ' ')" "" "duplicate keys"
}

# ── Tests ───────────────────────────────────────────────────────────────

test_help_and_unknown_commands() {
  fresh help
  run cli
  assert_rc 0 "no arguments"
  assert_contains "$OUT" "Usage: launchstack <command>" "no arguments prints help"
  run cli frobnicate
  assert_rc_nonzero "unknown command"
  assert_contains "$OUT" "Unknown command: frobnicate" "unknown command is named"
  assert_contains "$OUT" "Usage: launchstack <command>" "unknown command prints help"
  run cli help nonsense
  assert_rc_nonzero "help for an unknown command"
  local c
  for c in setup start stop restart status logs doctor update backup restore config version uninstall; do
    run cli "$c" --help
    assert_rc 0 "$c --help"
    assert_contains "$OUT" "Usage: launchstack $c" "$c --help shows its usage"
    run cli help "$c"
    assert_contains "$OUT" "Usage: launchstack $c" "help $c shows its usage"
  done
  assert_eq "$(wc -c <"$FAKE_DOCKER_LOG" | tr -d ' ')" "0" "help never calls docker"
  run cli config bogus
  assert_rc_nonzero "unknown config subcommand"
  run cli setup --bogus
  assert_rc_nonzero "unknown setup option"
}

test_commands_need_an_install_and_env() {
  fresh needs
  run cli start
  assert_rc_nonzero "start without .env"
  assert_contains "$OUT" "launchstack setup" "start without .env points at setup"
  run env LAUNCHSTACK_HOME="$BASE/nowhere" "$BASH_BIN" "$CLI" setup --non-interactive
  assert_rc_nonzero "setup without an install"
  assert_contains "$OUT" "compose.yml is missing" "setup without an install says why"
}

test_setup_local_gemini() {
  fresh setup-local
  setup_local_gemini
  assert_rc 0 "setup local+gemini"
  assert_file "$ENVF"
  assert_env_complete
  assert_eq "$(envval "$ENVF" DOMAIN)" "" "DOMAIN empty in local mode"
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "http://localhost:3000" "BETTER_AUTH_URL"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_HTTP_PORT)" "3000" "http port"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_FILES_PORT)" "8333" "files port"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_BIND)" "127.0.0.1" "bind"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "" "no profiles"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "1.2.3" "version from the bundle"
  assert_eq "$(envval "$ENVF" GOOGLE_AI_API_KEY)" "AIzaTESTKEY0123456789" "gemini key"
  assert_eq "$(envval "$ENVF" CHAT_BASE_URL)" "" "CHAT_BASE_URL unset for Gemini"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_BASE_URL)" "https://generativelanguage.googleapis.com/v1beta/openai" "embedding url"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_KEY)" "AIzaTESTKEY0123456789" "embedding key reuses the Gemini key"
  assert_eq "$(envval "$ENVF" EMBEDDING_MODEL)" "gemini-embedding-001" "embedding model"
  assert_eq "$(envval "$ENVF" EMBEDDING_INDEX)" "gemini-embedding-768" "embedding index"
  assert_match "$(envval "$ENVF" POSTGRES_PASSWORD)" '^[0-9a-f]{48}$' "POSTGRES_PASSWORD is URL-safe hex"
  assert_match "$(envval "$ENVF" INNGEST_EVENT_KEY)" '^[0-9a-f]{64}$' "INNGEST_EVENT_KEY hex"
  assert_match "$(envval "$ENVF" INNGEST_SIGNING_KEY)" '^[0-9a-f]{64}$' "INNGEST_SIGNING_KEY hex"
  assert_match "$(envval "$ENVF" BETTER_AUTH_SECRET)" '^[0-9a-f]{64}$' "BETTER_AUTH_SECRET hex"
  assert_eq "$(printf '%s' "$(envval "$ENVF" EMBEDDING_SECRETS_KEY)" | tr -d "'" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" "32" "EMBEDDING_SECRETS_KEY is 32 bytes of base64"
  assert_ne "$(envval "$ENVF" INNGEST_EVENT_KEY)" "$(envval "$ENVF" INNGEST_SIGNING_KEY)" "secrets differ from each other"
  assert_not_contains "$OUT" "AIzaTESTKEY0123456789" "the key is not printed"
  assert_contains "$OUT" "LaunchStack is running at http://localhost:3000" "prints the URL"
  assert_contains "$OUT" "Open it and create your account" "prints the next step"
  # Every compose call is pinned to the install.
  local pinned="compose --project-directory $LAUNCHSTACK_HOME -f $LAUNCHSTACK_HOME/compose.yml --env-file $LAUNCHSTACK_HOME/.env"
  assert_eq "$(grep '^compose' "$FAKE_DOCKER_LOG" | grep -v '^compose version' | grep -vc -- "^$pinned " | tr -d ' ')" "0" "every compose call is pinned"
  assert_logged "$pinned run --rm --no-deps -T migrate node scripts/deploy-check.mjs\$" "preflight"
  assert_logged "$pinned pull --policy always\$" "pull"
  assert_logged "$pinned up -d --remove-orphans\$" "up"
  local a b c
  a="$(log_line_of 'deploy-check.mjs')" b="$(log_line_of ' pull --policy always$')" c="$(log_line_of ' up -d')"
  if [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ]; then pass; else fail "order must be preflight, pull, up (lines $a $b $c)"; fi
}

test_setup_domain_azure() {
  fresh setup-domain
  run env LAUNCHSTACK_SETUP_ACCESS=domain LAUNCHSTACK_SETUP_DOMAIN=https://Stack.Example.com/ \
    LAUNCHSTACK_SETUP_ACME_EMAIL=ops@example.com \
    LAUNCHSTACK_SETUP_CHAT_PROVIDER=openai-compatible \
    LAUNCHSTACK_SETUP_CHAT_BASE_URL=https://acme.openai.azure.com/openai/v1/ \
    LAUNCHSTACK_SETUP_CHAT_API_KEY=azure-chat-key-123 \
    LAUNCHSTACK_SETUP_EMBEDDING_API_KEY=azure-embed-key-456 \
    LAUNCHSTACK_SETUP_OCR=yes \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "setup domain+azure"
  assert_env_complete
  assert_eq "$(envval "$ENVF" DOMAIN)" "stack.example.com" "domain is normalised"
  assert_eq "$(envval "$ENVF" ACME_EMAIL)" "ops@example.com" "acme email"
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "https://stack.example.com" "BETTER_AUTH_URL"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "domain,ocr" "profiles"
  assert_eq "$(envval "$ENVF" DOCLING_SERVE_URL)" "http://docling-serve:5001" "docling url with OCR"
  assert_eq "$(envval "$ENVF" CHAT_BASE_URL)" "https://acme.openai.azure.com/openai/v1" "chat url, trailing slash dropped"
  assert_eq "$(envval "$ENVF" CHAT_API_KEY)" "azure-chat-key-123" "chat key"
  assert_eq "$(envval "$ENVF" CHAT_MODELS_CONFIG)" "config/chat-models.azure.yaml" "azure model file"
  assert_eq "$(envval "$ENVF" GOOGLE_AI_API_KEY)" "" "no gemini key"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_BASE_URL)" "https://acme.openai.azure.com/openai/v1" "embeddings follow the Azure chat endpoint"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_KEY)" "azure-embed-key-456" "embedding key"
  assert_eq "$(envval "$ENVF" EMBEDDING_MODEL)" "text-embedding-3-large" "embedding model"
  assert_eq "$(envval "$ENVF" EMBEDDING_INDEX)" "legacy-openai-1536" "embedding index"
  assert_contains "$OUT" "Not starting" "--no-start says so"
  assert_not_logged "^compose" "--no-start makes no compose call"
}

test_setup_sslip_openai_extras() {
  fresh setup-sslip
  run env LAUNCHSTACK_SETUP_ACCESS=sslip LAUNCHSTACK_SETUP_PUBLIC_IP=203.0.113.10 \
    LAUNCHSTACK_SETUP_CHAT_PROVIDER=openai-compatible \
    LAUNCHSTACK_SETUP_CHAT_BASE_URL=https://api.openai.com/v1 \
    LAUNCHSTACK_SETUP_CHAT_API_KEY=sk-test-openai-key \
    LAUNCHSTACK_SETUP_WHISPER=yes LAUNCHSTACK_SETUP_SEARCH=yes \
    LAUNCHSTACK_SETUP_VERSION=v2.0.0 \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "setup sslip+openai"
  assert_env_complete
  assert_eq "$(envval "$ENVF" DOMAIN)" "203.0.113.10.sslip.io" "sslip domain"
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "https://203.0.113.10.sslip.io" "BETTER_AUTH_URL"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "domain,whisper,search" "profiles"
  assert_eq "$(envval "$ENVF" CHAT_MODELS_CONFIG)" "config/chat-models.yaml" "default model file"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_BASE_URL)" "https://api.openai.com/v1" "OpenAI embeddings inferred from OpenAI chat"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_KEY)" "sk-test-openai-key" "embedding key defaults to the chat key on the same endpoint"
  assert_eq "$(envval "$ENVF" EMBEDDING_INDEX)" "legacy-openai-1536" "embedding index"
  assert_eq "$(envval "$ENVF" TRANSCRIPTION_PROVIDER)" "sidecar" "whisper selects the sidecar"
  assert_eq "$(envval "$ENVF" SEARCH_PROVIDER)" "searxng" "search provider"
  assert_eq "$(envval "$ENVF" SEARXNG_URL)" "http://searxng:8080" "searxng url"
  assert_eq "$(grep -c '^DOCLING_SERVE_URL=' "$ENVF" | tr -d ' ')" "0" "no docling variable without OCR"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "2.0.0" "version tag drops the v"
}

test_setup_gemini_chat_with_openai_embeddings_and_ports() {
  fresh setup-mixed edge
  run env LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 \
    LAUNCHSTACK_SETUP_EMBEDDING_PROVIDER=openai LAUNCHSTACK_SETUP_EMBEDDING_API_KEY=sk-embed-only-key \
    LAUNCHSTACK_SETUP_HTTP_PORT=8080 LAUNCHSTACK_SETUP_BIND=0.0.0.0 \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "setup gemini chat + openai embeddings"
  assert_env_complete
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "http://localhost:8080" "URL follows the port"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_BIND)" "0.0.0.0" "bind"
  assert_eq "$(envval "$ENVF" EMBEDDING_API_BASE_URL)" "https://api.openai.com/v1" "embedding url"
  assert_eq "$(envval "$ENVF" EMBEDDING_MODEL)" "text-embedding-3-large" "embedding model"
  assert_eq "$(envval "$ENVF" EMBEDDING_INDEX)" "legacy-openai-1536" "embedding index"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "latest" "an edge bundle runs the latest images"
}

test_setup_lan() {
  fresh setup-lan
  run env LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 \
    LAUNCHSTACK_SETUP_BIND=0.0.0.0 LAUNCHSTACK_SETUP_LAN_HOST=192.168.1.20 \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "setup on a LAN"
  assert_env_complete
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "http://192.168.1.20:3000" "BETTER_AUTH_URL carries the LAN address"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_FILES_URL)" "http://192.168.1.20:8333" "LAUNCHSTACK_FILES_URL carries the LAN address"
  # Re-running keeps the LAN address; going back to loopback removes the files URL.
  run cli setup --non-interactive --no-start
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_FILES_URL)" "http://192.168.1.20:8333" "a re-run keeps the LAN address"
  run env LAUNCHSTACK_SETUP_BIND=127.0.0.1 "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_eq "$(envval "$ENVF" BETTER_AUTH_URL)" "http://localhost:3000" "loopback goes back to localhost"
  assert_eq "$(grep -c '^LAUNCHSTACK_FILES_URL=' "$ENVF" | tr -d ' ')" "0" "loopback removes LAUNCHSTACK_FILES_URL"
  run env LAUNCHSTACK_SETUP_HTTP_PORT=8333 "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "the app and files ports must differ"
}

test_setup_extras_off_removes_companions() {
  fresh setup-extras
  run env LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 \
    LAUNCHSTACK_SETUP_OCR=yes LAUNCHSTACK_SETUP_WHISPER=yes LAUNCHSTACK_SETUP_SEARCH=yes \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "ocr,whisper,search" "all extras on"
  assert_eq "$(envval "$ENVF" DOCLING_SERVE_URL)" "http://docling-serve:5001" "ocr companion"
  assert_eq "$(envval "$ENVF" TRANSCRIPTION_PROVIDER)" "sidecar" "whisper companion"
  assert_eq "$(envval "$ENVF" SEARCH_PROVIDER)$(envval "$ENVF" SEARXNG_URL)" "searxnghttp://searxng:8080" "search companions"
  run env LAUNCHSTACK_SETUP_OCR=no LAUNCHSTACK_SETUP_WHISPER=no LAUNCHSTACK_SETUP_SEARCH=no \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "extras off"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "" "all extras off"
  assert_eq "$(grep -cE '^(DOCLING_SERVE_URL|TRANSCRIPTION_PROVIDER|SEARCH_PROVIDER|SEARXNG_URL)=' "$ENVF" | tr -d ' ')" "0" "companion variables are removed"
  assert_env_complete
  # Another search engine the operator configured is not ours to remove.
  cli config set SEARCH_PROVIDER=exa EXA_API_KEY=exa-key-12345 >/dev/null
  run cli setup --non-interactive --no-start
  assert_eq "$(envval "$ENVF" SEARCH_PROVIDER)" "exa" "an operator's search engine survives setup"
}

test_setup_rejects_bad_input() {
  fresh setup-bad
  run env LAUNCHSTACK_SETUP_ACCESS=domain LAUNCHSTACK_SETUP_DOMAIN="not a domain" \
    LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "bad domain"
  assert_contains "$OUT" "LAUNCHSTACK_SETUP_DOMAIN" "bad domain names the variable"
  assert_no_file "$ENVF"
  run cli setup --non-interactive --no-start
  assert_rc_nonzero "missing chat key"
  assert_contains "$OUT" "LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY" "missing key names the variable"
  assert_no_file "$ENVF"
  run env LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY="has space in it" "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "key with a space"
  run env LAUNCHSTACK_SETUP_ACCESS=sslip LAUNCHSTACK_SETUP_PUBLIC_IP=300.1.1.1 \
    LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "bad IP"
  run env LAUNCHSTACK_SETUP_CHAT_PROVIDER=openai-compatible LAUNCHSTACK_SETUP_CHAT_BASE_URL=ftp://x \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "bad URL"
  run env LAUNCHSTACK_SETUP_HTTP_PORT=99999 LAUNCHSTACK_SETUP_GOOGLE_AI_API_KEY=AIzaTESTKEY0123456789 \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "bad port"
  run env LAUNCHSTACK_SETUP_CHAT_PROVIDER=claude "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc_nonzero "unknown provider"
  assert_no_file "$ENVF"
}

test_setup_rerun_preserves_secrets() {
  fresh setup-rerun
  setup_local_gemini
  assert_rc 0 "first setup"
  local before after k
  before="$(for k in $GENERATED_SECRETS; do printf '%s=%s\n' "$k" "$(envval "$ENVF" "$k")"; done)"
  printf '# mine\nAUTH_GOOGLE_CLIENT_ID=my-client-id\n' >>"$ENVF"
  # Second run: no key given (the stored one is kept), a domain and an extra added.
  run env LAUNCHSTACK_SETUP_ACCESS=domain LAUNCHSTACK_SETUP_DOMAIN=stack.example.com LAUNCHSTACK_SETUP_SEARCH=yes \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_rc 0 "second setup"
  after="$(for k in $GENERATED_SECRETS; do printf '%s=%s\n' "$k" "$(envval "$ENVF" "$k")"; done)"
  assert_eq "$after" "$before" "generated secrets are unchanged by a second setup"
  assert_env_complete
  assert_eq "$(envval "$ENVF" DOMAIN)" "stack.example.com" "second run applies the new domain"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "domain,search" "second run applies the new profiles"
  assert_eq "$(envval "$ENVF" GOOGLE_AI_API_KEY)" "AIzaTESTKEY0123456789" "the stored key is kept when none is given"
  assert_eq "$(envval "$ENVF" EMBEDDING_INDEX)" "gemini-embedding-768" "the index is kept"
  assert_eq "$(envval "$ENVF" AUTH_GOOGLE_CLIENT_ID)" "my-client-id" "operator additions survive"
  assert_contains "$(cat "$ENVF")" "# mine" "operator comments survive"
  assert_contains "$OUT" "13 kept" "reports the secrets as kept"
  assert_file "$ENVF.previous"
  assert_eq "$(file_mode "$ENVF.previous")" "600" ".env.previous mode"
  # Third run with nothing: still the domain install (answers default to the file).
  run cli setup --non-interactive --no-start
  assert_rc 0 "third setup"
  assert_eq "$(envval "$ENVF" DOMAIN)" "stack.example.com" "third run keeps the domain"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "domain,search" "third run keeps the profiles"
  # Switching the embedding provider on an install with data is called out.
  run env LAUNCHSTACK_SETUP_EMBEDDING_PROVIDER=openai LAUNCHSTACK_SETUP_EMBEDDING_API_KEY=sk-embed-only-key \
    "$BASH_BIN" "$CLI" setup --non-interactive --no-start
  assert_contains "$OUT" "changes the embedding index" "an index change is warned about"
}

test_setup_interactive() {
  fresh setup-interactive
  # access=1, chat=1, key, embeddings=1, OCR n, Whisper n, search y, confirm y
  run "$BASH_BIN" -c 'printf "1\n1\nAIzaINTERACTIVEKEY000\n1\nn\nn\ny\ny\n" | "$0" "$1" setup --no-start' "$BASH_BIN" "$CLI"
  assert_rc 0 "interactive setup"
  assert_env_complete
  assert_eq "$(envval "$ENVF" GOOGLE_AI_API_KEY)" "AIzaINTERACTIVEKEY000" "typed key is stored"
  assert_eq "$(envval "$ENVF" COMPOSE_PROFILES)" "search" "typed extras"
  assert_not_contains "$OUT" "AIzaINTERACTIVEKEY000" "the typed key is never echoed or summarised"
  assert_contains "$OUT" "Configuration" "a summary is shown before writing"
  assert_contains "$OUT" "Write this configuration?" "asks before writing"

  # Invalid answers are asked again; declining the summary writes nothing.
  fresh setup-interactive-decline
  run "$BASH_BIN" -c 'printf "2\nnot a domain\nstack.example.com\n\n1\nshort\nAIzaINTERACTIVEKEY000\n1\nn\nn\nn\nn\n" | "$0" "$1" setup --no-start' "$BASH_BIN" "$CLI"
  assert_rc_nonzero "declined setup"
  assert_contains "$OUT" "Enter a host name" "an invalid domain is explained and asked again"
  assert_contains "$OUT" "https://stack.example.com" "the corrected domain reaches the summary"
  assert_contains "$OUT" "nothing was written" "declining says nothing was written"
  assert_no_file "$ENVF"

  # Input ending early is an error, not a half-written file.
  run "$BASH_BIN" -c 'printf "1\n" | "$0" "$1" setup --no-start' "$BASH_BIN" "$CLI"
  assert_rc_nonzero "truncated input"
  assert_no_file "$ENVF"
}

test_setup_stops_on_failed_preflight_or_health() {
  fresh setup-preflight
  export FAKE_DOCKER_PREFLIGHT_RC=1
  setup_local_gemini
  assert_rc_nonzero "setup with failing preflight"
  assert_file "$ENVF"
  assert_not_logged " pull --policy always\$" "nothing is pulled after a failed preflight"
  assert_not_logged " up -d" "nothing is started after a failed preflight"

  # start and restart are guarded too: `config edit` then `restart` is how
  # settings change.
  : >"$FAKE_DOCKER_LOG"
  run cli start
  assert_rc_nonzero "start with failing preflight"
  assert_contains "$OUT" "configuration check failed" "start names the reason"
  run cli restart
  assert_rc_nonzero "restart with failing preflight"
  assert_not_logged " up -d" "start and restart touch nothing after a failed preflight"
  unset FAKE_DOCKER_PREFLIGHT_RC

  export FAKE_DOCKER_UNHEALTHY_VERSION=1.2.3 LAUNCHSTACK_HEALTH_TIMEOUT=0
  run cli start
  assert_rc_nonzero "start that never becomes healthy"
  assert_contains "$OUT" "fails its health check" "an unhealthy app is reported without waiting out the timeout"
  assert_not_contains "$OUT" "LaunchStack is running at" "no success message"
  unset FAKE_DOCKER_UNHEALTHY_VERSION LAUNCHSTACK_HEALTH_TIMEOUT

  export FAKE_DOCKER_INFO_RC=1
  run cli start
  assert_rc_nonzero "start with the daemon down"
  assert_contains "$OUT" "Cannot reach the Docker daemon" "daemon message"
}

test_config() {
  fresh config
  setup_local_gemini
  local secret lines
  secret="$(envval "$ENVF" POSTGRES_PASSWORD)"
  run cli config show
  assert_rc 0 "config show"
  assert_not_contains "$OUT" "$secret" "config show hides POSTGRES_PASSWORD"
  assert_not_contains "$OUT" "AIzaTESTKEY0123456789" "config show hides API keys"
  assert_not_contains "$OUT" "$(envval "$ENVF" EMBEDDING_SECRETS_KEY | tr -d "'")" "config show hides EMBEDDING_SECRETS_KEY"
  assert_contains "$OUT" "POSTGRES_PASSWORD=[redacted, 48 chars]" "config show marks redaction"
  assert_contains "$OUT" "BETTER_AUTH_URL=http://localhost:3000" "config show prints plain values"
  assert_contains "$OUT" "EMBEDDING_INDEX=gemini-embedding-768" "config show prints plain values"
  local k
  for k in $GENERATED_SECRETS; do
    assert_not_contains "$OUT" "$k=$(envval "$ENVF" "$k")" "config show hides $k"
  done
  run cli config
  assert_contains "$OUT" "[redacted" "bare config is show"

  lines="$(wc -l <"$ENVF" | tr -d ' ')"
  run cli config set LAUNCHSTACK_HTTP_PORT=8088 'AUTH_OIDC_NAME=Acme SSO' 'EXA_API_KEY=exa$key&1'
  assert_rc 0 "config set"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_HTTP_PORT)" "8088" "config set replaces in place"
  assert_eq "$(grep -c '^LAUNCHSTACK_HTTP_PORT=' "$ENVF" | tr -d ' ')" "1" "config set leaves one line"
  assert_eq "$(wc -l <"$ENVF" | tr -d ' ')" "$((lines + 2))" "config set appends only the new keys"
  assert_eq "$(envval "$ENVF" POSTGRES_PASSWORD)" "$secret" "config set leaves other lines alone"
  assert_eq "$(file_mode "$ENVF")" "600" ".env mode after config set"
  assert_eq "$(envval "$ENVF" AUTH_OIDC_NAME)" "'Acme SSO'" "values with spaces are single-quoted"
  assert_not_contains "$OUT" 'exa$key&1' "config set does not echo secrets"
  run cli config get AUTH_OIDC_NAME
  assert_eq "$OUT" "Acme SSO" "config get unquotes"
  run cli config get EXA_API_KEY
  assert_eq "$OUT" 'exa$key&1' "config get returns the literal value"
  run cli config set 'BAD NAME=1'
  assert_rc_nonzero "config set with a bad name"
  run cli config set NOEQUALS
  assert_rc_nonzero "config set without ="
  run cli config set "QUOTE=it's"
  assert_rc_nonzero "config set with a single quote"
  # The comment header written by setup is still there.
  assert_contains "$(head -n 1 "$ENVF")" "# LaunchStack configuration" "comments survive config set"
  run env EDITOR=true "$BASH_BIN" "$CLI" config edit
  assert_rc 0 "config edit runs \$EDITOR"
}

test_lifecycle_commands() {
  fresh lifecycle
  setup_local_gemini
  : >"$FAKE_DOCKER_LOG"
  run cli stop
  assert_rc 0 "stop"
  assert_logged " down --remove-orphans\$" "stop"
  assert_logged "--profile \* down --remove-orphans\$" "stop reaches services whose profile was switched off"
  run cli restart
  assert_rc 0 "restart"
  assert_logged " up -d --remove-orphans --force-recreate\$" "restart"
  a="$(log_line_of 'deploy-check.mjs')" b="$(log_line_of ' up -d --remove-orphans --force-recreate$')"
  if [ "$a" -lt "$b" ]; then pass; else fail "restart must check the configuration before recreating ($a $b)"; fi
  run cli logs --no-follow app worker
  assert_logged " logs --tail 200 app worker\$" "logs"
  run cli logs
  assert_logged " logs --tail 200 -f\$" "logs follow"
  run cli status
  assert_rc 0 "status"
  assert_contains "$OUT" "http://localhost:3000" "status shows the URL"
  assert_contains "$OUT" "healthy" "status shows health"
  run cli version
  assert_contains "$OUT" "launchstack 1.2.3" "version"
  assert_not_logged "--volumes" "no lifecycle command removes volumes"
  assert_not_logged " -v\( \|\$\)" "no lifecycle command removes volumes"
  export FAKE_DOCKER_DOWN=1
  run cli status
  assert_rc_nonzero "status when nothing runs"
  assert_contains "$OUT" "not running" "status says the stack is not running"
}

test_doctor() {
  fresh doctor
  setup_local_gemini
  : >"$FAKE_DOCKER_LOG"
  run cli doctor
  assert_rc 0 "doctor"
  assert_logged "run --rm --no-deps -T migrate node scripts/deploy-check.mjs --probe\$" "doctor probes"
  assert_contains "$OUT" "Every container is healthy" "doctor summarises health"
  export FAKE_DOCKER_PREFLIGHT_RC=1
  run cli doctor
  assert_rc_nonzero "doctor with a failing preflight"
  unset FAKE_DOCKER_PREFLIGHT_RC
  export FAKE_DOCKER_UNHEALTHY_VERSION=1.2.3
  run cli doctor
  assert_rc_nonzero "doctor with an unhealthy container"
  assert_contains "$OUT" "unhealthy" "doctor names the unhealthy state"
}

test_backup_and_restore() {
  fresh backup
  setup_local_gemini
  local file="$BASE/out/my-backup.tar.gz" listing secret
  secret="$(envval "$ENVF" POSTGRES_PASSWORD)"
  run cli backup "$file"
  assert_rc 0 "backup"
  assert_file "$file"
  assert_eq "$(file_mode "$file")" "600" "backup mode"
  listing="$(tar -tzf "$file" | sort | tr '\n' ' ')"
  assert_eq "$listing" "db.sql env manifest.txt storage.tar " "backup members"
  assert_logged " exec -T db pg_dumpall -U postgres --clean --if-exists\$" "backup dumps every database"
  assert_logged " exec -T seaweedfs tar -C /data -cf - \.\$" "backup copies the storage volume"
  mkdir -p "$BASE/x"
  tar -xzf "$file" -C "$BASE/x"
  assert_contains "$(cat "$BASE/x/db.sql")" "fake pg_dumpall output" "db.sql holds the dump"
  assert_eq "$(tar -tf "$BASE/x/storage.tar" | grep -c 'blob.bin' | tr -d ' ')" "1" "storage.tar holds the files"
  assert_eq "$(envval "$BASE/x/env" POSTGRES_PASSWORD)" "$secret" "backup holds .env"
  assert_eq "$(find "$LAUNCHSTACK_HOME/backups" -name '.backup.*' | wc -l | tr -d ' ')" "0" "no temp files left"
  run cli backup
  assert_rc 0 "backup with the default name"
  assert_eq "$(find "$LAUNCHSTACK_HOME/backups" -name 'launchstack-*.tar.gz' | wc -l | tr -d ' ')" "1" "default backup location"

  # Restore: needs the word, or --yes.
  cli config set POSTGRES_PASSWORD=changed-after-backup >/dev/null
  : >"$FAKE_DOCKER_LOG"
  run "$BASH_BIN" -c 'printf "no\n" | "$0" "$1" restore "$2"' "$BASH_BIN" "$CLI" "$file"
  assert_rc_nonzero "restore without confirmation"
  assert_contains "$OUT" "cancelled" "restore cancels"
  assert_eq "$(envval "$ENVF" POSTGRES_PASSWORD)" "changed-after-backup" "a cancelled restore changes nothing"
  assert_not_logged " down" "a cancelled restore stops nothing"
  run cli restore "$file" --yes
  assert_rc 0 "restore --yes"
  assert_eq "$(envval "$ENVF" POSTGRES_PASSWORD)" "$secret" "restore puts .env back"
  assert_eq "$(file_mode "$ENVF")" "600" ".env mode after restore"
  assert_eq "$(envval "$ENVF.before-restore" POSTGRES_PASSWORD)" "changed-after-backup" "the replaced .env is kept"
  assert_contains "$(cat "$FAKE_DOCKER_STATE/psql-input")" "fake pg_dumpall output" "restore feeds the dump to psql"
  assert_eq "$(tar -tf "$FAKE_DOCKER_STATE/storage-input" | grep -c 'blob.bin' | tr -d ' ')" "1" "restore feeds the files to the storage volume"
  local a b c d
  a="$(log_line_of ' down --remove-orphans')" b="$(log_line_of ' exec -T db psql')"
  c="$(log_line_of ' --entrypoint sh seaweedfs')" d="$(log_line_of ' up -d --remove-orphans')"
  if [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && [ "$c" -lt "$d" ]; then pass; else fail "restore order must be down, psql, storage, up ($a $b $c $d)"; fi
  run "$BASH_BIN" -c 'printf "restore\n" | "$0" "$1" restore "$2"' "$BASH_BIN" "$CLI" "$file"
  assert_rc 0 "restore with typed confirmation"
  run cli restore "$CLI" --yes
  assert_rc_nonzero "restore of a file that is not a backup"
  run cli restore
  assert_rc_nonzero "restore without a file"
  export FAKE_DOCKER_DOWN=1
  run cli backup
  assert_rc_nonzero "backup with the stack down"
  assert_contains "$OUT" "launchstack start" "backup with the stack down says what to do"
}

test_update_and_rollback() {
  fresh update
  setup_local_gemini
  printf 'my edit\n' >"$LAUNCHSTACK_HOME/docker/filer.toml"
  make_bundle "$BASE/bundle-new" 1.3.0 "filer v2"
  make_tarball "$BASE/bundle-new" "$BASE/new.tar.gz"
  export LAUNCHSTACK_INSTALLER="$INSTALLER" LAUNCHSTACK_BUNDLE="$BASE/new.tar.gz"
  : >"$FAKE_DOCKER_LOG"
  run cli update
  assert_rc 0 "update"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "1.3.0" "update sets LAUNCHSTACK_VERSION"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/VERSION")" "1.3.0" "update refreshes the bundle"
  assert_contains "$(cat "$LAUNCHSTACK_HOME/compose.yml")" "bundle 1.3.0" "update refreshes compose.yml"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/docker/filer.toml")" "my edit" "an edited docker file is kept"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/docker/filer.toml.new")" "filer v2" "the release's copy is written beside it"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/docker/searxng/settings.yml")" "settings 1.3.0" "an unedited docker file is replaced"
  assert_eq "$(find "$LAUNCHSTACK_HOME/backups" -name 'pre-update-*.tar.gz' | wc -l | tr -d ' ')" "1" "update takes a backup"
  local a b c
  a="$(log_line_of 'pg_dumpall')" b="$(log_line_of ' pull --policy always$')" c="$(log_line_of ' up -d')"
  if [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ]; then pass; else fail "update order must be backup, pull, up ($a $b $c)"; fi
  assert_no_file "$HOME/.local/bin/launchstack"

  # A release that never becomes healthy is rolled back.
  make_bundle "$BASE/bundle-bad" 9.9.9
  make_tarball "$BASE/bundle-bad" "$BASE/bad.tar.gz"
  export LAUNCHSTACK_BUNDLE="$BASE/bad.tar.gz" FAKE_DOCKER_UNHEALTHY_VERSION=9.9.9 LAUNCHSTACK_HEALTH_TIMEOUT=0
  run cli update --no-backup
  assert_rc_nonzero "update to a broken release"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "1.3.0" "LAUNCHSTACK_VERSION is rolled back"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/VERSION")" "1.3.0" "the bundle is rolled back"
  assert_contains "$(cat "$LAUNCHSTACK_HOME/compose.yml")" "bundle 1.3.0" "compose.yml is rolled back"
  assert_eq "$(cat "$FAKE_DOCKER_STATE/running-version")" "1.3.0" "the previous version is started again"
  assert_contains "$OUT" "Rolling back to 1.3.0" "the rollback is reported"
  assert_eq "$(cat "$LAUNCHSTACK_HOME/docker/filer.toml")" "my edit" "the edited file survives a rollback"

  # A release whose preflight rejects the configuration is rolled back. The
  # check runs in the new release's image, so the pull comes first.
  unset FAKE_DOCKER_UNHEALTHY_VERSION LAUNCHSTACK_HEALTH_TIMEOUT
  export FAKE_DOCKER_PREFLIGHT_RC=1
  : >"$FAKE_DOCKER_LOG"
  run cli update --no-backup
  assert_rc_nonzero "update rejected by preflight"
  assert_eq "$(envval "$ENVF" LAUNCHSTACK_VERSION)" "1.3.0" "LAUNCHSTACK_VERSION is rolled back after a failed preflight"
  a="$(log_line_of ' pull --policy always$')" b="$(log_line_of 'deploy-check.mjs')"
  if [ "$a" -lt "$b" ]; then pass; else fail "update must pull before the preflight ($a $b)"; fi
}

test_uninstall() {
  fresh uninstall
  setup_local_gemini
  mkdir -p "$HOME/.local/bin"
  ln -s "$LAUNCHSTACK_HOME/bin/launchstack" "$HOME/.local/bin/launchstack"
  printf 'keep me\n' >"$LAUNCHSTACK_HOME/backups/old.tar.gz"
  : >"$FAKE_DOCKER_LOG"
  run "$BASH_BIN" -c 'printf "n\n" | "$0" "$1" uninstall' "$BASH_BIN" "$CLI"
  assert_rc_nonzero "uninstall declined"
  assert_file "$LAUNCHSTACK_HOME/compose.yml"
  run cli uninstall --yes
  assert_rc 0 "uninstall"
  assert_logged " down --remove-orphans\$" "uninstall removes containers"
  assert_not_logged "--volumes" "uninstall keeps volumes"
  assert_file "$ENVF"
  assert_file "$LAUNCHSTACK_HOME/backups/old.tar.gz"
  assert_no_file "$LAUNCHSTACK_HOME/compose.yml"
  assert_no_file "$LAUNCHSTACK_HOME/bin"
  assert_no_file "$HOME/.local/bin/launchstack"

  fresh purge
  setup_local_gemini
  printf 'keep me\n' >"$LAUNCHSTACK_HOME/backups/old.tar.gz"
  : >"$FAKE_DOCKER_LOG"
  # --yes does not stand in for the typed phrase.
  run "$BASH_BIN" -c 'printf "yes\n" | "$0" "$1" uninstall --purge --yes' "$BASH_BIN" "$CLI"
  assert_rc_nonzero "purge with the wrong phrase"
  assert_file "$ENVF"
  assert_not_logged " down" "a cancelled purge removes nothing"
  run "$BASH_BIN" -c 'printf "delete everything\n" | "$0" "$1" uninstall --purge' "$BASH_BIN" "$CLI"
  assert_rc 0 "purge with the phrase"
  assert_logged " down --volumes --remove-orphans\$" "purge removes volumes"
  assert_no_file "$ENVF"
  assert_no_file "$LAUNCHSTACK_HOME/compose.yml"
  assert_file "$LAUNCHSTACK_HOME/backups/old.tar.gz"
}

test_install_from_bundle() {
  fresh install
  local home="$BASE/fresh-install" bin="$BASE/bin"
  make_bundle "$BASE/b1" 2.0.0 "filer v1"
  make_tarball "$BASE/b1" "$BASE/b1.tar.gz"
  mkdir -p "$bin"
  run env LAUNCHSTACK_HOME="$home" LAUNCHSTACK_BUNDLE="$BASE/b1.tar.gz" LAUNCHSTACK_BIN_DIR="$bin" PATH="$bin:$PATH" \
    "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "install from a bundle"
  assert_file "$home/compose.yml"
  assert_file "$home/docker/filer.toml"
  assert_file "$home/docker/searxng/settings.yml"
  assert_file "$home/bin/launchstack"
  assert_eq "$(cat "$home/VERSION")" "2.0.0" "VERSION"
  if [ -x "$home/bin/launchstack" ]; then pass; else fail "the CLI is not executable"; fi
  if [ -d "$home/backups" ]; then pass; else fail "backups/ was not created"; fi
  assert_eq "$(readlink "$bin/launchstack")" "$home/bin/launchstack" "the CLI is linked"
  assert_no_file "$home/.env"
  assert_eq "$(printf '%s\n' "$OUT" | tail -n 1)" "  launchstack setup" "ends by printing launchstack setup"
  assert_not_contains "$OUT" "not on your PATH" "no PATH note when the directory is on PATH"
  # The linked CLI finds its install without LAUNCHSTACK_HOME.
  run env -u LAUNCHSTACK_HOME "$bin/launchstack" version
  assert_contains "$OUT" "install     $home" "the linked CLI resolves its home through the symlink"

  # Second run: an upgrade that keeps .env, backups/ and edited docker files.
  printf 'POSTGRES_PASSWORD=do-not-touch\n' >"$home/.env"
  chmod 600 "$home/.env"
  printf 'backup\n' >"$home/backups/keep.tar.gz"
  printf 'my edit\n' >"$home/docker/filer.toml"
  make_bundle "$BASE/b2" 2.1.0 "filer v2"
  make_tarball "$BASE/b2" "$BASE/b2.tar.gz"
  run env LAUNCHSTACK_HOME="$home" LAUNCHSTACK_BUNDLE="$BASE/b2.tar.gz" LAUNCHSTACK_BIN_DIR="$bin" "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "second install"
  assert_eq "$(cat "$home/VERSION")" "2.1.0" "re-running upgrades the bundle"
  assert_contains "$(cat "$home/compose.yml")" "bundle 2.1.0" "compose.yml upgraded"
  assert_eq "$(cat "$home/.env")" "POSTGRES_PASSWORD=do-not-touch" ".env is untouched"
  assert_eq "$(file_mode "$home/.env")" "600" ".env mode is untouched"
  assert_eq "$(cat "$home/backups/keep.tar.gz")" "backup" "backups/ is untouched"
  assert_eq "$(cat "$home/docker/filer.toml")" "my edit" "an edited docker file is kept"
  assert_eq "$(cat "$home/docker/filer.toml.new")" "filer v2" "the new copy is written beside it"
  assert_eq "$(cat "$home/docker/searxng/settings.yml")" "settings 2.1.0" "unedited docker files are upgraded"
  assert_contains "$OUT" "not on your PATH" "says when the link directory is not on PATH"
  assert_contains "$OUT" "existing configuration (.env) was kept" "says .env was kept"

  # Third run with the same bundle changes nothing (idempotent).
  local before after
  before="$(cd "$home" && find . -type f ! -path './.bundle*' -exec cksum {} + | sort)"
  run env LAUNCHSTACK_HOME="$home" LAUNCHSTACK_BUNDLE="$BASE/b2.tar.gz" LAUNCHSTACK_BIN_DIR="$bin" "$BASH_BIN" "$INSTALLER"
  after="$(cd "$home" && find . -type f ! -path './.bundle*' -exec cksum {} + | sort)"
  assert_eq "$after" "$before" "installing the same bundle again changes nothing"

  # Default link location, in the temp HOME.
  run env LAUNCHSTACK_HOME="$BASE/third" LAUNCHSTACK_BUNDLE="$BASE/b1.tar.gz" "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "install with the default link directory"
  if [ -L "$HOME/.local/bin/launchstack" ] || [ -L "/usr/local/bin/launchstack" ]; then pass; else fail "no CLI link in ~/.local/bin"; fi
  assert_eq "$(readlink "$HOME/.local/bin/launchstack")" "$BASE/third/bin/launchstack" "linked into ~/.local/bin of the test HOME"
}

test_install_refuses_bad_input() {
  fresh install-bad
  export FAKE_DOCKER_INFO_RC=1
  run env LAUNCHSTACK_HOME="$BASE/x" LAUNCHSTACK_BUNDLE="$BASE/none.tar.gz" "$BASH_BIN" "$INSTALLER"
  assert_rc_nonzero "install with the daemon down"
  assert_contains "$OUT" "daemon is not reachable" "daemon message"
  assert_contains "$OUT" "https://docs.docker.com" "daemon message has a link"
  assert_no_file "$BASE/x"
  unset FAKE_DOCKER_INFO_RC
  run env LAUNCHSTACK_HOME="$BASE/x" LAUNCHSTACK_BUNDLE="$BASE/none.tar.gz" "$BASH_BIN" "$INSTALLER"
  assert_rc_nonzero "install from a missing bundle"
  # A bundle without the CLI is refused before anything is written.
  mkdir -p "$BASE/partial"
  printf 'x\n' >"$BASE/partial/compose.yml"
  printf '1\n' >"$BASE/partial/VERSION"
  tar -C "$BASE/partial" -czf "$BASE/partial.tar.gz" compose.yml VERSION
  run env LAUNCHSTACK_HOME="$BASE/x" LAUNCHSTACK_BUNDLE="$BASE/partial.tar.gz" "$BASH_BIN" "$INSTALLER"
  assert_rc_nonzero "install from an incomplete bundle"
  assert_contains "$OUT" "incomplete" "incomplete bundle message"
  assert_no_file "$BASE/x"
  # No docker on PATH at all (only checkable where the system dirs have none).
  if ! PATH="/usr/bin:/bin" command -v docker >/dev/null 2>&1; then
    run env PATH="/usr/bin:/bin" LAUNCHSTACK_HOME="$BASE/x" LAUNCHSTACK_BUNDLE="$BASE/none.tar.gz" "$BASH_BIN" "$INSTALLER"
    assert_rc_nonzero "install without docker"
    assert_contains "$OUT" "Docker is not installed" "missing docker message"
    assert_contains "$OUT" "https://docs.docker.com/get-docker/" "missing docker link"
  fi
}

test_install_resolves_latest_release() {
  command -v curl >/dev/null 2>&1 || return 0
  fresh install-latest
  local rel="$BASE/releases"
  mkdir -p "$rel/v3.1.0"
  make_bundle "$BASE/b" 3.1.0
  make_tarball "$BASE/b" "$rel/v3.1.0/launchstack-self-host.tar.gz"
  # Newest first, as the API lists them: a package release without the bundle,
  # a prerelease with it, then the release that should be picked.
  cat >"$BASE/releases.json" <<'JSON'
[
  {"tag_name": "@launchstack/store@4.0.0", "name": "store 4.0.0", "draft": false, "prerelease": false,
   "assets": [], "body": "notes mention \"name\": \"launchstack-self-host.tar.gz\" in passing"},
  {"tag_name": "v3.2.0-rc.1", "name": "3.2.0 rc", "draft": false, "prerelease": true,
   "assets": [{"id": 1, "name": "launchstack-self-host.tar.gz", "size": 10}]},
  {"tag_name": "v3.1.0", "name": "3.1.0", "draft": false, "prerelease": false,
   "assets": [{"id": 2, "name": "checksums.txt"}, {"id": 3, "name": "launchstack-self-host.tar.gz", "size": 10}]},
  {"tag_name": "v3.0.0", "name": "3.0.0", "draft": false, "prerelease": false,
   "assets": [{"id": 4, "name": "launchstack-self-host.tar.gz", "size": 10}]}
]
JSON
  run env LAUNCHSTACK_HOME="$BASE/latest" LAUNCHSTACK_NO_LINK=1 \
    LAUNCHSTACK_API_URL="file://$BASE/releases.json" LAUNCHSTACK_DOWNLOAD_BASE="file://$rel" "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "install the latest release"
  assert_eq "$(cat "$BASE/latest/VERSION" 2>/dev/null)" "3.1.0" "picks the newest full release that carries the bundle"
  assert_no_file "$HOME/.local/bin/launchstack"
  # An explicit version is fetched as v<version>; one that does not exist fails.
  run env LAUNCHSTACK_HOME="$BASE/pinned" LAUNCHSTACK_NO_LINK=1 LAUNCHSTACK_VERSION=3.1.0 \
    LAUNCHSTACK_DOWNLOAD_BASE="file://$rel" "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "install a pinned release"
  assert_eq "$(cat "$BASE/pinned/VERSION" 2>/dev/null)" "3.1.0" "pinned version"
  run env LAUNCHSTACK_HOME="$BASE/missing" LAUNCHSTACK_NO_LINK=1 LAUNCHSTACK_VERSION=8.8.8 \
    LAUNCHSTACK_DOWNLOAD_BASE="file://$rel" "$BASH_BIN" "$INSTALLER"
  assert_rc_nonzero "install a release that does not exist"
  assert_contains "$OUT" "has no launchstack-self-host.tar.gz" "missing release message"
  assert_no_file "$BASE/missing"
}

test_scripts_are_pipe_safe() {
  CURRENT="pipe-safe"
  # The last line of each script is the only top-level call into it.
  assert_eq "$(tail -n 1 "$INSTALLER")" 'main "$@"' "install.sh ends with main"
  assert_eq "$(tail -n 1 "$CLI")" 'main "$@"' "launchstack ends with main"
  # A download cut short must not run anything.
  fresh pipe
  head -n $(($(wc -l <"$INSTALLER") - 1)) "$INSTALLER" >"$BASE/truncated.sh"
  run env LAUNCHSTACK_HOME="$BASE/x" "$BASH_BIN" "$BASE/truncated.sh"
  assert_eq "$(wc -c <"$FAKE_DOCKER_LOG" | tr -d ' ')" "0" "a truncated install.sh runs nothing"
  assert_no_file "$BASE/x"
  # Piped, as in `curl … | bash`.
  make_bundle "$BASE/b" 2.0.0
  make_tarball "$BASE/b" "$BASE/b.tar.gz"
  run env LAUNCHSTACK_HOME="$BASE/piped" LAUNCHSTACK_BUNDLE="$BASE/b.tar.gz" LAUNCHSTACK_NO_LINK=1 \
    "$BASH_BIN" -c '"$0" <"$1"' "$BASH_BIN" "$INSTALLER"
  assert_rc 0 "install.sh read from stdin"
  assert_file "$BASE/piped/compose.yml"
}

# ── Runner ──────────────────────────────────────────────────────────────

TESTS="$(declare -F | sed -n 's/^declare -f \(test_[a-z_]*\)$/\1/p')"
RAN=0
for t in $TESTS; do
  case "$t" in
    *"$FILTER"*) ;;
    *) continue ;;
  esac
  CURRENT="${t#test_}"
  before_fail="$FAIL"
  "$t"
  RAN=$((RAN + 1))
  if [ "$FAIL" = "$before_fail" ]; then
    printf 'ok    %s\n' "$CURRENT"
  else
    printf 'FAIL  %s\n' "$CURRENT"
  fi
done

printf '\n%s tests, %s assertions passed, %s failed (bash %s)\n' "$RAN" "$PASS" "$FAIL" "$BASH_VERSION"
[ "$RAN" -gt 0 ] || {
  printf 'no test matches "%s"\n' "$FILTER"
  exit 1
}
[ "$FAIL" = "0" ]
