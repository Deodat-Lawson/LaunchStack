#!/usr/bin/env bash
# Run the storage-owner FK integrity reproduction against local Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SQL="$ROOT/scripts/repro/storage-owner-fk/01_polymorphic_vs_exclusive_fks.sql"
DB_NAME="${STORAGE_OWNER_FK_REPRO_DB:-storage_owner_fk_repro}"
OUT_DIR="${STORAGE_OWNER_FK_REPRO_OUT:-/tmp/cursor/artifacts}"
OUT_FILE="$OUT_DIR/storage-owner-fk-repro.log"

mkdir -p "$OUT_DIR"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  PSQL=(psql -v ON_ERROR_STOP=1)
elif command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)
else
  PSQL=(psql -v ON_ERROR_STOP=1)
fi

echo "Creating database $DB_NAME (if needed)..."
"${PSQL[@]}" -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 \
  || "${PSQL[@]}" -c "CREATE DATABASE $DB_NAME"

echo "Running reproduction SQL..."
"${PSQL[@]}" -d "$DB_NAME" -f "$SQL" | tee "$OUT_FILE"

echo
echo "Running static orphan-path checks..."
ORPHAN_OUT="$OUT_DIR/current-orphan-delete-path.log"
node "$ROOT/scripts/repro/storage-owner-fk/02_current_orphan_delete_path.mjs" | tee "$ORPHAN_OUT"

echo
echo "Wrote FK transcript to $OUT_FILE"
echo "Wrote orphan-path transcript to $ORPHAN_OUT"
