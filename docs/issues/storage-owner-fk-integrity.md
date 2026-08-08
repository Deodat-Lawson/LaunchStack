# Storage owner FK integrity — why polymorphic ownership breaks deletion

**Related:** [LAU-20](https://linear.app/launchstack/issue/LAU-20), [GitHub #313](https://github.com/Deodat-Lawson/LaunchStack/issues/313)

**Reproduction:** `scripts/repro/storage-owner-fk/run.sh`

## What we reproduced

Kareem’s schema question for the LAU-20 storage manifest (`storage_objects`): an object is owned by **exactly one** of several parent tables (`document`, `document_version`, `artifact_group`). Two patterns look plausible:

| Pattern | Shape | DB referential integrity |
| --- | --- | --- |
| 1. Polymorphic FK | `owner_type` + `owner_id` | **None.** Postgres cannot attach one FK to three tables. |
| 2. Exclusive nullable FKs | `document_id` / `document_version_id` / `artifact_group_id` + `CHECK` that exactly one is non-null | **Full.** Each column is a real FK; owner delete can `RESTRICT` / `CASCADE` deliberately. |

Running the repro against Postgres 16 shows:

1. **Pattern 1:** delete the owning `document_versions` row → the polymorphic manifest row **survives with a dangling `owner_id`**. The database cannot stop this.
2. **Pattern 2:** the same owner delete is **rejected by FK** while the manifest row exists; zero-owner and multi-owner inserts are rejected by `CHECK`.

Transcript: `/tmp/cursor/artifacts/storage-owner-fk-repro.log` (produced by `run.sh`).

## Why we had this issue in the first place

This is not an abstract modeling preference. It is the schema consequence of today’s storage deletion failure.

### 1. Upload captures object identity, then discards it

S3/Blob/DB uploads already know provider + key/pathname at write time, but document registration persists **URLs only**. `storageProvider` / `storagePathname` are accepted on the upload API and dropped before the document row is created. `file_uploads` has provider metadata but **no FK ownership** back to a document/version.

So there is no durable “these bytes belong to this owner” row the deleter can trust.

### 2. Normal delete is DB-only

`DELETE /api/deleteDocument` and batch delete call ordered SQL deletes (see `document-delete.ts` / `deleteDocument/route.ts`) and return success after the Postgres transaction. They never:

- snapshot version/artifact URLs or opaque refs,
- call `StoragePort` / `deleteFileByUrl`,
- distinguish “SQL gone” from “bytes gone”.

`document_versions` cascade off `document`, so even the URL evidence disappears while S3/Blob/`file_uploads` bytes remain. That is the P0 orphan class in #313.

### 3. The partial paths that *do* touch storage are still unsafe

Version delete calls `deleteFileByUrl`, but:

- S3 key recovery strips only the endpoint and leaves the bucket in `Key`,
- Vercel Blob has no delete wiring (falls through to a no-op database branch),
- `/api/files/{id}` returns early without deleting the `file_uploads` row.

Those bugs amplify the same root omission: **no owned, provider-opaque manifest**.

### 4. LAU-20 therefore needs exclusive ownership on `storage_objects`

The deletion lifecycle design requires:

1. register an opaque `ObjectRef` under an exclusive owner before the document/version becomes active,
2. snapshot owned refs into a deletion outbox **before** relational cascade,
3. hard-delete SQL only after storage is `DELETED` / `NOT_FOUND`.

That lifecycle is only sound if the database itself refuses dangling or ambiguous ownership. Polymorphic `(owner_type, owner_id)` cannot do that — the repro’s dangling row after owner delete is exactly the integrity hole a deletion coordinator must not have. Exclusive nullable FK columns + an exactly-one `CHECK` (Pattern 2) are the Postgres-native fit for a closed set of three owner kinds.

## Recommendation

Use **Pattern 2** for `storage_objects` ownership:

- real FKs to `document` / `document_versions` / artifact-group table,
- `CHECK` that exactly one owner column is non-null,
- `ON DELETE RESTRICT` (or equivalent) so relational purge cannot race ahead of the storage worker,
- app helpers that set exactly one owner column from a typed owner union.

Accept the two NULL columns per row. For this table, nullability is cheaper than unverifiable ownership during delete/retry/quarantine.

## How to re-run

```bash
# requires local Postgres (psql) with a role that can CREATE DATABASE
./scripts/repro/storage-owner-fk/run.sh
```
