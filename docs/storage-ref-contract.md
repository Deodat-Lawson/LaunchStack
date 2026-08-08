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
