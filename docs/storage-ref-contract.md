# Storage Reference Contract (A0 Freeze)

This document captures the frozen storage contract used by server-side upload/deletion flows.

## Rules

- Callers never parse URLs to invent storage keys.
- The only allowed URL-to-ref conversion path is [apps/web/src/server/storage/legacy-promote.ts](../apps/web/src/server/storage/legacy-promote.ts).
- `storageLocationId` is server-resolved from configured adapter environment.
- Clients do not guess, derive, or mint `storageLocationId`.

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

## Delete outcomes

Deletion uses per-ref outcome reporting (`DeleteResult.outcome`):

- `deleted`
- `not_found`
- `retryable`
- `blocked`
- `rejected`

`deleteRef` / `deleteMany` return outcomes instead of a bare throw.

## Deferred port scope

The frozen lifecycle contract covers provider-owned identity and deletion. Full naming parity for `put`, `get`, and `getSignedUrl` is intentionally deferred; the current `StoragePort` continues to expose `upload` and `download` until existing ingestion callers can migrate without a compatibility break. New deletion and manifest code must use `ObjectRef`, `deleteRef`, and `deleteMany`; the legacy URL `delete` method remains only as a promotion shim for historical rows.
