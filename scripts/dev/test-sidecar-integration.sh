#!/usr/bin/env bash
# Integration test: verify the split compute services (ADR-004) are reachable
# and functional:
#   - transcription    (services/transcription)    → /health, auth gate
#   - document-editor  (services/document-editor)  → /health, /adeu/read, /adeu/diff
#
# Prerequisites: both services running locally, e.g. via docker compose with
# service names `transcription` and `document-editor`.
#
# This script:
#   1. Checks transcription /health returns ok and /transcribe fails closed (401)
#   2. Checks document-editor /health returns adeu available + pinned version
#   3. Sends a test DOCX to /adeu/read and verifies text extraction
#   4. Sends the same DOCX to /adeu/diff (identical) and verifies no differences

set -euo pipefail

# Host ports for each service. Compose wiring for the split services lands
# separately; until then these defaults assume `transcription` published on
# 8000 (the old sidecar port) and `document-editor` on 8003.
TRANSCRIPTION_PORT="${TRANSCRIPTION_PORT:-8000}"
DOCUMENT_EDITOR_PORT="${DOCUMENT_EDITOR_PORT:-8003}"
TRANSCRIPTION_URL="${TRANSCRIPTION_URL:-http://localhost:$TRANSCRIPTION_PORT}"
DOCUMENT_EDITOR_URL="${DOCUMENT_EDITOR_URL:-http://localhost:$DOCUMENT_EDITOR_PORT}"

# Every route except /health is authenticated and fails closed. Each service
# reads its own key env var, falling back to the legacy SIDECAR_API_KEY; the
# final default matches docker-compose.yml's fallback so this script works
# against `make up`.
TRANSCRIPTION_API_KEY="${TRANSCRIPTION_API_KEY:-${SIDECAR_API_KEY:-pdr_local_sidecar_key}}"
DOCUMENT_EDITOR_API_KEY="${DOCUMENT_EDITOR_API_KEY:-${SIDECAR_API_KEY:-pdr_local_sidecar_key}}"

PASS=0
FAIL=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label (expected to contain: $needle)"
    FAIL=$((FAIL + 1))
  fi
}

wait_for() {
  local name="$1" url="$2"
  echo "Waiting for $name at $url ..."
  for i in $(seq 1 30); do
    if curl -sf "$url/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  red "$name did not become healthy at $url"
  exit 1
}

wait_for "transcription" "$TRANSCRIPTION_URL"
wait_for "document-editor" "$DOCUMENT_EDITOR_URL"

# ── Test 1: Transcription health + fail-closed auth ────────────────────────
echo ""
echo "=== Test 1: transcription /health + auth gate ==="
T_HEALTH=$(curl -sf "$TRANSCRIPTION_URL/health")
T_STATUS=$(echo "$T_HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
assert_eq "transcription health status is ok" "ok" "$T_STATUS"

# /transcribe without a key must 401 (fail-closed), never accept work.
T_AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TRANSCRIPTION_URL/transcribe")
assert_eq "unauthenticated /transcribe is rejected" "401" "$T_AUTH_CODE"

# ── Test 2: Document-editor health check ───────────────────────────────────
echo ""
echo "=== Test 2: document-editor /health ==="
D_HEALTH=$(curl -sf "$DOCUMENT_EDITOR_URL/health")
D_STATUS=$(echo "$D_HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
ADEU_AVAIL=$(echo "$D_HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['adeu']['available'])")
ADEU_VER=$(echo "$D_HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['adeu']['version'])")

assert_eq "document-editor health status is ok" "ok" "$D_STATUS"
assert_eq "adeu available is True" "True" "$ADEU_AVAIL"

# Read expected adeu version dynamically from the service's requirements.txt.
# This script lives at scripts/dev/, so the repository root is two levels up.
EXPECTED_ADEU_VER=$(grep -E '^adeu==' "$(dirname "$0")/../../services/document-editor/requirements.txt" | head -1 | cut -d'=' -f3)
if [ -z "$EXPECTED_ADEU_VER" ]; then
  red "Could not determine expected adeu version from services/document-editor/requirements.txt"
  FAIL=$((FAIL + 1))
else
  assert_eq "adeu version matches requirements.txt ($EXPECTED_ADEU_VER)" "$EXPECTED_ADEU_VER" "$ADEU_VER"
fi

# ── Create a test DOCX ────────────────────────────────────────────────────
TMPDIR=$(mktemp -d)
python3 -c "
from docx import Document
import sys
doc = Document()
doc.add_paragraph('Integration test paragraph one.')
doc.add_paragraph('Integration test paragraph two.')
doc.save('$TMPDIR/test.docx')
print('DOCX created', file=sys.stderr)
" 2>&1

# ── Test 3: Read DOCX ─────────────────────────────────────────────────────
echo ""
echo "=== Test 3: POST /adeu/read ==="
READ_RESP=$(curl -sf -X POST "$DOCUMENT_EDITOR_URL/adeu/read" \
  -H "X-API-Key: $DOCUMENT_EDITOR_API_KEY" \
  -F "file=@$TMPDIR/test.docx" \
  -F "clean_view=false")
assert_contains "response contains paragraph text" "Integration test paragraph one" "$READ_RESP"

# ── Test 4: Diff identical files ───────────────────────────────────────────
echo ""
echo "=== Test 4: POST /adeu/diff (identical) ==="
DIFF_RESP=$(curl -sf -X POST "$DOCUMENT_EDITOR_URL/adeu/diff" \
  -H "X-API-Key: $DOCUMENT_EDITOR_API_KEY" \
  -F "original=@$TMPDIR/test.docx" \
  -F "modified=@$TMPDIR/test.docx" \
  -F "compare_clean=true")
HAS_DIFF=$(echo "$DIFF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['has_differences'])")
assert_eq "identical files have no differences" "False" "$HAS_DIFF"

# ── Cleanup ────────────────────────────────────────────────────────────────
rm -rf "$TMPDIR"

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All integration tests passed."
