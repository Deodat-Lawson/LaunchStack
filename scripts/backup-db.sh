#!/usr/bin/env bash
# ============================================================================
# Database backup script for Launchstack
#
# Usage:
#   ./scripts/backup-db.sh                    # Uses DATABASE_URL from .env
#   DATABASE_URL="postgres://..." ./scripts/backup-db.sh
#
# Options (via env vars):
#   BACKUP_DIR     - Directory to store backups (default: ./backups)
#   BACKUP_RETAIN  - Number of days to retain old backups (default: 30)
#   BACKUP_COMPRESS - Set to "0" to skip gzip compression (default: compressed)
#
# Cron example (daily at 2 AM):
#   0 2 * * * cd /path/to/project && ./scripts/backup-db.sh >> /var/log/launchstack-backup.log 2>&1
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if DATABASE_URL is not already set
if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$PROJECT_DIR/.env" ]]; then
  export "$(grep -E '^DATABASE_URL=' "$PROJECT_DIR/.env" | head -1 | xargs)"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Provide it via environment or .env file." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILENAME="launchstack_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "[$(date --iso-8601=seconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)] Starting database backup..."

# Run pg_dump
pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists > "$BACKUP_DIR/$FILENAME"

# Compress unless disabled
if [[ "${BACKUP_COMPRESS:-1}" != "0" ]]; then
  gzip "$BACKUP_DIR/$FILENAME"
  FILENAME="${FILENAME}.gz"
fi

FILESIZE=$(du -h "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "[$(date --iso-8601=seconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)] Backup complete: $FILENAME ($FILESIZE)"

# Prune old backups
if [[ "$BACKUP_RETAIN" -gt 0 ]]; then
  DELETED=$(find "$BACKUP_DIR" -name "launchstack_*.sql*" -mtime "+$BACKUP_RETAIN" -delete -print | wc -l | tr -d ' ')
  if [[ "$DELETED" -gt 0 ]]; then
    echo "[$(date --iso-8601=seconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)] Pruned $DELETED backup(s) older than $BACKUP_RETAIN days"
  fi
fi
