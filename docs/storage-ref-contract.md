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
