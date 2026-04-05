#!/usr/bin/env bash
# =============================================================================
# Workstream A: SeaweedFS Infrastructure Smoke Test
#
# Prerequisites:
#   docker compose --env-file .env --profile local-storage up db seaweedfs
#
# Usage:
#   bash scripts/test-seaweedfs-infra.sh
#
# Requires: aws cli (brew install awscli)
# =============================================================================

set -euo pipefail

ENDPOINT="http://localhost:8333"
REGION="us-east-1"
BUCKET="pdr-test-infra-$$"
ACCESS_KEY="pdr_local_key"
SECRET_KEY="pdr_local_secret"

export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"

PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if eval "$*" > /dev/null 2>&1; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

cleanup() {
  aws --endpoint-url "$ENDPOINT" --region "$REGION" \
    s3 rb "s3://$BUCKET" --force > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo ""
echo "SeaweedFS Infrastructure Smoke Test"
echo "===================================="
echo ""

# --- Container checks ---
echo "[Containers]"
check "postgres is running" \
  "docker ps --filter name=pdr_ai_v2-postgres --format '{{.Status}}' | grep -q Up"
check "seaweedfs is running" \
  "docker ps --filter name=pdr_ai_v2-seaweedfs --format '{{.Status}}' | grep -q Up"

# --- PostgreSQL checks ---
echo ""
echo "[PostgreSQL]"
check "pdr_ai_v2 database exists" \
  "docker exec pdr_ai_v2-postgres psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='pdr_ai_v2'\" | grep -q 1"
check "seaweedfs database exists" \
  "docker exec pdr_ai_v2-postgres psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='seaweedfs'\" | grep -q 1"
check "filemeta table exists" \
  "docker exec pdr_ai_v2-postgres psql -U postgres -d seaweedfs -tc \"SELECT 1 FROM information_schema.tables WHERE table_name='filemeta'\" | grep -q 1"
check "pgvector extension loaded" \
  "docker exec pdr_ai_v2-postgres psql -U postgres -d pdr_ai_v2 -tc \"SELECT 1 FROM pg_extension WHERE extname='vector'\" | grep -q 1"

# --- S3 Gateway checks ---
echo ""
echo "[S3 Gateway]"
check "S3 gateway responds" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 ls"

check "create bucket" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 mb s3://$BUCKET"

# Upload
echo "test file content for infra smoke test" > /tmp/seaweedfs-infra-test.txt
check "upload file (PutObject)" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 cp /tmp/seaweedfs-infra-test.txt s3://$BUCKET/documents/test.txt"

# Download
check "download file (GetObject)" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 cp s3://$BUCKET/documents/test.txt /tmp/seaweedfs-infra-download.txt"

# Verify content
check "content matches" \
  "diff /tmp/seaweedfs-infra-test.txt /tmp/seaweedfs-infra-download.txt"

# List
check "list objects" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 ls s3://$BUCKET/documents/"

# Presigned URL
PRESIGNED=$(aws --endpoint-url "$ENDPOINT" --region "$REGION" s3 presign "s3://$BUCKET/documents/test.txt" --expires-in 60 2>&1)
check "presigned URL generation" "test -n '$PRESIGNED'"
check "presigned URL fetch" "curl -sf '$PRESIGNED' -o /dev/null"

# Delete
check "delete object" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 rm s3://$BUCKET/documents/test.txt"

# Binary upload (512KB)
dd if=/dev/urandom of=/tmp/seaweedfs-infra-binary.bin bs=1024 count=512 2>/dev/null
check "binary upload (512KB)" \
  "aws --endpoint-url $ENDPOINT --region $REGION s3 cp /tmp/seaweedfs-infra-binary.bin s3://$BUCKET/documents/binary.bin"

# --- Volume persistence ---
echo ""
echo "[Volume Persistence]"
check "volume data directory populated" \
  "docker exec pdr_ai_v2-seaweedfs test -d /data"

# --- Summary ---
echo ""
echo "===================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "STATUS: FAILED ($FAIL failures)"
  exit 1
else
  echo "STATUS: ALL PASSED"
  exit 0
fi
