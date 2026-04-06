#!/usr/bin/env bash
# Integration test: verify sidecar Adeu endpoints are reachable and functional.
#
# Prerequisites:
#   docker compose -f docker-compose.yml -f docker-compose.test.yml up sidecar --build -d
#
# This script:
#   1. Checks /health returns adeu available + version 0.9.0
#   2. Sends a test DOCX to /adeu/read and verifies text extraction
#   3. Sends the same DOCX to /adeu/diff (identical) and verifies no differences

set -euo pipefail

BASE_URL="${SIDECAR_URL:-http://localhost:8000}"
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

# ── Wait for sidecar to be ready ───────────────────────────────────────────
echo "Waiting for sidecar at $BASE_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ── Test 1: Health check ───────────────────────────────────────────────────
echo ""
echo "=== Test 1: Health check ==="
HEALTH=$(curl -sf "$BASE_URL/health")
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
ADEU_AVAIL=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['adeu']['available'])")
ADEU_VER=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['adeu']['version'])")

assert_eq "health status is ok" "ok" "$STATUS"
assert_eq "adeu available is True" "True" "$ADEU_AVAIL"
assert_eq "adeu version is 0.9.0" "0.9.0" "$ADEU_VER"

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

# ── Test 2: Read DOCX ─────────────────────────────────────────────────────
echo ""
echo "=== Test 2: POST /adeu/read ==="
READ_RESP=$(curl -sf -X POST "$BASE_URL/adeu/read" \
  -F "file=@$TMPDIR/test.docx" \
  -F "clean_view=false")
assert_contains "response contains paragraph text" "Integration test paragraph one" "$READ_RESP"

# ── Test 3: Diff identical files ───────────────────────────────────────────
echo ""
echo "=== Test 3: POST /adeu/diff (identical) ==="
DIFF_RESP=$(curl -sf -X POST "$BASE_URL/adeu/diff" \
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
