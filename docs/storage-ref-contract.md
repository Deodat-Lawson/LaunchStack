# Storage Reference Contract (A0 Freeze)

This document captures the frozen storage contract used by server-side upload/deletion flows.

## Rules

- Callers never parse URLs to invent storage keys.
- The only allowed URL-to-ref conversion path is [apps/web/src/server/storage/legacy-promote.ts](../apps/web/src/server/storage/legacy-promote.ts).
- `storageLocationId` is server-resolved from configured adapter environment.
- Clients do not guess, derive, or mint `storageLocationId`.
- `ObjectRef` is opaque and immutable once minted.
- New `STORAGE_S3_*` env vars take precedence over legacy S3 env names; legacy names remain supported for compatibility.

## ObjectRef

`ObjectRef` is immutable and opaque:

- `adapter`: `"s3" | "vercel-blob" | "database" | "uploadthing"`
- `storageLocationId`: adapter location identity string
- `key`: adapter-specific object key (never URL-derived by callers)

## Frozen storageLocationId formulas

- S3: `s3:{NEXT_PUBLIC_S3_ENDPOINT}@{S3_BUCKET_NAME}`
- Vercel Blob: `vercel-blob:{storeId}` where `storeId = token.split("_")[3]`
- Database: `database:pdr_file_uploads_v1`
- UploadThing: `uploadthing:{appId}[@region]`

## S3-compatible env var reference (B5)

S3 adapter configuration accepts the `STORAGE_S3_*` names below (legacy names remain supported; precedence rules are defined in A1):

- `STORAGE_S3_ENDPOINT` — provider/API endpoint used for SDK calls.
- `STORAGE_S3_PUBLIC_ENDPOINT` — optional public/base URL for minted object URLs.
- `STORAGE_S3_REGION` — region value for request signing.
- `STORAGE_S3_ACCESS_KEY` — access key id credential.
- `STORAGE_S3_SECRET_KEY` — secret access key credential.
- `STORAGE_S3_BUCKET_NAME` — bucket/container name.
- `STORAGE_S3_FORCE_PATH_STYLE` — optional boolean, defaults to path-style (`true`).
- `STORAGE_S3_ENSURE_BUCKET_EXISTS` — optional boolean, default `false` (opt-in bucket bootstrap).

Legacy aliases still recognized by runtime and env parsing:

- `NEXT_PUBLIC_S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`
- `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`

Current limitation note: URL minting is path-style today. With `STORAGE_S3_FORCE_PATH_STYLE=false`, signed requests can be virtual-hosted-style, but minted object URLs remain path-style until `getObjectUrl` gains virtual-host formatting.

## Delete outcomes

Deletion uses per-ref outcome reporting (`DeleteResult.outcome`):

- `deleted`
- `not_found`
- `retryable`
- `blocked`
- `rejected`

`deleteRef` / `deleteMany` return outcomes instead of a bare throw.

Worker/state mapping (frozen):

- `deleted` → `DELETED`
- `not_found` → `NOT_FOUND` (clean)
- `retryable` → `WAITING_RETRY`
- `blocked` → `BLOCKED` / manual review
- `rejected` → `QUARANTINED` / quarantined

Blocked/rejected outcomes are terminal for that adapter attempt and must not fall
through to another adapter.

## Port surface

The storage contract now distinguishes canonical methods from compatibility
aliases:

- Canonical methods:
  - `put`
  - `get`
  - `delete`
  - `deleteMany`
  - `getSignedUrl`
- Explicit adapter targeting:
  - `getStoragePort().forAdapter(adapter)`
- Deprecated compatibility aliases:
  - `upload`
  - `download`
  - `deleteRef`

Canonical write/read/delete flows should move toward `ObjectRef`-based calls.
Deprecated aliases remain so existing callers can migrate incrementally without
changing lifecycle behavior.

## Database adapter read path during C3 transition

For database-backed refs, `ObjectRef.key` is the numeric `fileUploads.id`
encoded as a string. Until the database adapter is extracted, `get(ref)` on the
app port resolves that key to `/api/files/{id}` and calls `fetchFile`, which
adds internal service headers for a self-origin request. The `/api/files/[id]`
route remains the single place for tenant authorization and serve-gating before
reading the Postgres row.

`forAdapter("database")` remains unwired until C3. Callers reading a database
ref should use `getStoragePort().get(ref)` during this transition rather than
targeting the unwired database handle or duplicating the route's authorization
logic in another adapter.

## Lifecycle feature flags (exactly two)

- `STORAGE_DELETION_LIFECYCLE_ENABLED` (intake gate, default off)
- `STORAGE_DELETION_WORKER_ENABLED` (worker gate, default off)

When intake is disabled, APIs return HTTP `503`/`409` and do not bypass into
legacy direct-delete behavior.

## Deletion API status enum (frozen)

- `queued`
- `completed`
- `partial`
- `manual_review`
- `quarantined`

Dominance rules:

- `quarantined` dominates when required items are quarantined without approved bypass
- `manual_review` dominates when any item is blocked
- `completed` only when all required items are `DELETED`/`NOT_FOUND` and relational purge is done

## Deferred port scope

The frozen lifecycle contract still covers provider-owned identity and deletion.
This contract update only locks the canonical method names and adapter-targeting
shape; it does not by itself rewire existing app call sites. New deletion and
manifest code must continue to use `ObjectRef` and `deleteMany`, while the
legacy URL `delete` overload remains a promotion shim for historical rows until
downstream migration work lands.
