# SeaweedFS Local Storage — Testing Guide

This guide walks through setting up and verifying SeaweedFS as a local S3-compatible storage backend for PDR AI, replacing Vercel Blob for self-hosted deployments.

## Prerequisites

- Docker and Docker Compose installed
- Node.js and pnpm installed
- AWS CLI (optional, for manual verification): `brew install awscli`

## 1. Configure Environment

Add these variables to your `.env` file:

```bash
NEXT_PUBLIC_STORAGE_PROVIDER="local"
NEXT_PUBLIC_S3_ENDPOINT="http://localhost:8333"
S3_REGION="us-east-1"
S3_ACCESS_KEY="pdr_local_key"
S3_SECRET_KEY="pdr_local_secret"
S3_BUCKET_NAME="pdr-documents"
```

These credentials match the defaults in `docker/s3-config.json`. If you change one, update the other to match.

## 2. Start the Stack

Remove any leftover containers from previous runs, then start fresh:

```bash
docker container prune -f
docker compose --env-file .env --profile local-storage up db seaweedfs -d
```

Wait ~5 seconds for Postgres to become healthy (SeaweedFS depends on it). You can check with:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Both `pdr_ai_v2-postgres` and `pdr_ai_v2-seaweedfs` should show `Up`.

## 3. Start the App

```bash
pnpm dev
```

No manual bucket creation needed — the app auto-creates the S3 bucket on the first upload request.

## 4. Test the Upload Flow (UI)

1. Navigate to `/employer/upload`
2. The storage method selector should show "SeaweedFS (Local)" instead of the cloud toggle
3. Upload a PDF or document
4. Watch the progress bar:
   - ~15% → presign request fired to `/api/storage/presign`
   - ~20–90% → file uploading directly to SeaweedFS via XHR
   - 100% → OCR pipeline triggered via `/api/uploadDocument`

## 5. Verify the File Landed in SeaweedFS

List objects in the bucket:

```bash
AWS_ACCESS_KEY_ID=pdr_local_key \
AWS_SECRET_ACCESS_KEY=pdr_local_secret \
aws s3 ls s3://pdr-documents/documents/ --endpoint-url http://localhost:8333
```

You should see your file with a UUID-prefixed name, e.g.:

```
2026-03-22 10:15:00  524288 a1b2c3d4-5678-9abc-def0-yourfile.pdf
```

Download and open it to verify content:

```bash
AWS_ACCESS_KEY_ID=pdr_local_key \
AWS_SECRET_ACCESS_KEY=pdr_local_secret \
aws s3 cp s3://pdr-documents/documents/<full-key> /tmp/downloaded.pdf --endpoint-url http://localhost:8333
open /tmp/downloaded.pdf
```

Or verify via curl:

```bash
curl -I http://localhost:8333/pdr-documents/documents/<full-key>
```

Should return `HTTP 200` with the correct `Content-Type`.

## 6. Verify Document Retrieval

After the OCR job completes, open the document in the app's document viewer. The app routes SeaweedFS URLs through `fetchFile` (plain `fetch`) — if the document renders, retrieval is working.

You can also test the file proxy API directly:

```bash
curl -I http://localhost:3000/api/files/<file_upload_id>
```

## 7. Regression Check — Cloud Mode

Swap back to cloud mode in `.env`:

```bash
NEXT_PUBLIC_STORAGE_PROVIDER="cloud"
```

Restart the dev server and do a test upload. It should go through UploadThing or Vercel Blob as before. Verify `storage_provider = 'vercel_blob'` in the database.

## 8. Infrastructure Smoke Test (Optional)

Run the automated 17-check infrastructure test:

```bash
bash scripts/test-seaweedfs-infra.sh
```

This validates containers, PostgreSQL databases, S3 operations (upload, download, list, delete, presigned URLs), and volume persistence. Requires AWS CLI.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Container name conflict on `docker compose up` | Leftover containers from previous runs | `docker container prune -f` then retry |
| Presign returns 400 "not applicable for cloud storage" | `NEXT_PUBLIC_STORAGE_PROVIDER` not set to `"local"` | Check `.env`, restart dev server |
| Presign returns 500 with S3 error | SeaweedFS not running or not healthy | Check `docker ps`, restart containers |
| XHR upload fails with 403 | Presigned URL expired (>5 min) or credential mismatch | Retry upload; verify `.env` credentials match `docker/s3-config.json` |
| SeaweedFS won't start | Postgres not healthy yet | Wait for db, then `docker compose restart seaweedfs` |
| `filemeta` table errors in SeaweedFS logs | `init-db.sql` didn't run | `docker compose down -v` and start fresh |
| `Server: SeaweedFS 30GB` in response headers | Normal — this is the version banner, not a storage limit | No action needed |

## Architecture Notes

- SeaweedFS runs under the `local-storage` Docker Compose profile — it only starts when explicitly requested
- The S3 bucket is auto-created on first use via `ensureBucketExists()` (idempotent, cached per process)
- SeaweedFS filer metadata is stored in a dedicated `seaweedfs` PostgreSQL database (separate from the app's `pdr_ai_v2` database)
- Volume data persists in the `seaweedfs_data` Docker volume across container restarts
- Use `docker compose --profile local-storage down -v` to wipe all data and start fresh
