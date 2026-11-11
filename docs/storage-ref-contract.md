# Stored object reference contract

This ports the storage identity and deletion contract from PRs #337 and #357 by
Tiffany Wei (@t1ffnyw), with karMareal1 and sfloody1, onto the current storage
implementation. It addresses the byte-cleanup defects described in issue #313;
the durable document-deletion lifecycle is a separate layer.

## Identity

`apps/web/src/server/storage/object-ref.ts` defines:

```ts
interface ObjectRef {
  readonly adapter: "s3" | "database" | "vercel-blob" | "uploadthing";
  readonly storageLocationId: string;
  readonly key: string;
}
```

A key is meaningful only inside its adapter and location. `refIdentity(ref)` is
the NUL-joined `(adapter, storageLocationId, key)` triple. Persist refs as fields,
not by splitting that diagnostic identity string. `uploadFile` and `putFile`
return a ref alongside their existing URL and pathname metadata. Database keys
are `String(file_uploads.id)`, not the generated `storage_pathname`. Blob keys
are the SDK's returned `blob.pathname`, not the upload's requested pathname.

`location.ts` is the single resolver for the location a process may mutate:

| Adapter     | Location id                          | Configuration                               |
| ----------- | ------------------------------------ | ------------------------------------------- |
| S3          | `s3:${normalizedEndpoint}@${bucket}` | `NEXT_PUBLIC_S3_ENDPOINT`, `S3_BUCKET_NAME` |
| Database    | `database:file_uploads`              | The engine's configured database            |
| Vercel Blob | `vercel-blob:${storeId}`             | `BLOB_READ_WRITE_TOKEN`                     |
| UploadThing | `uploadthing:${appId}`               | `UPLOADTHING_TOKEN`                         |

S3 endpoint normalization uses `new URL(endpoint).origin + pathname`, stripping
trailing path slashes; URL parsing lowercases the host. Invalid or missing
endpoint/bucket yields no configured location. `S3_PUBLIC_ENDPOINT` is a URL
alias, not a second location. No additional S3 client or environment family is
introduced.

Vercel's token format is `vercel_blob_rw_<storeId>_<secret>`; store identity is
lowercased, matching DNS host identity. The installed `@vercel/blob` SDK reads
`token.split("_")[3]`. UploadThing v7's installed `UploadThingToken` schema
decodes a base64 JSON object containing `appId` (with `apiKey` and `regions` for
SDK use). Missing/unparseable tokens yield no configured location. Neither
resolver infers identity from arbitrary token fragments.

## Stored URLs

`refFromStoredUrl(url)` never throws. It returns `{ ok: true, ref }`, or
`{ ok: false, reason: "unrecognized" | "ambiguous" }`. External web links are
unrecognized, not objects to delete. Distinct matching interpretations are
ambiguous; equivalent S3 endpoint aliases do not count twice.

Accepted forms:

- Database: `/api/files/{id}`, or an absolute URL on the exact internal origin
  (`APP_PUBLIC_URL ?? "http://app:3000"`). Recognition reuses the store's
  `parseInternalFileId` and `isInternalFileUrl` helpers, including query strings.
- S3: either configured endpoint's exact origin and path prefix, followed by
  `/{bucket}/{key}`. The key excludes the bucket; deleting
  `/files/documents/a.pdf` sends `documents/a.pdf`, not
  `files/documents/a.pdf`. Public-endpoint URLs resolve to the internal
  endpoint's location. A different URL bucket is retained in the ref's
  location so deletion is blocked instead of targeting the current bucket.
- Blob: `https://<storeId>.public.blob.vercel-storage.com/<pathname>` or the
  corresponding `.private.blob.` host. Store identity comes from the URL host,
  **not** today's token. The pathname is decoded with its leading slash removed.
- UploadThing: `https://utfs.io/f/<key>`,
  `https://uploadthing.com/f/<key>`, or `https://<appId>.ufs.sh/f/<key>`.
  The `ufs.sh` host supplies app identity; legacy hosts require the configured
  token's app id. The installed SDK defaults to `ufs.sh` with app id in the
  subdomain. Keys are URL-decoded.

Malformed percent encoding is unrecognized. Origin/path matching is bounded;
lookalike hostnames and endpoint-prefix collisions do not authorize deletion.

Database-backed documents and versions persist the canonical relative
`/api/files/{id}` URL. An absolute internal URL is only a processing input, not
stored object identity; an unset `APP_PUBLIC_URL` must not stamp a request's
arbitrary origin into persistent URLs.

Normalize existing document/version rows with
`pnpm --filter @launchstack/web db:backfill --only=2026-11-document-file-urls --batch=500`
(`DATABASE_URL` required; `--dry-run` supported). It only rewrites exact
`^https?://[^/]+/api/files/(\d+)$` values when the file exists and its non-null
`company_id` matches the owning document (also for versions, via their document).
Foreign-company, missing, and unstamped files are unchanged and counted as
`skipped_unowned` in each batch's log. The backfill is resumable and idempotent;
query strings, fragments, suffixes and external object URLs remain unchanged.

## Deletion

`deleteStoredObjects(refs: readonly ObjectRef[]): Promise<DeleteResult[]>`
groups requests by provider and returns exactly one result per input occurrence
in **input order**, including duplicates. Each provider's `deleteObjects` has
the same signature and ordering guarantee. Provider failures become results,
not thrown exceptions.

| Outcome     | Meaning                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `deleted`   | Provider acknowledged deletion (possibly already absent where the provider cannot distinguish).   |
| `not_found` | Provider positively reported that no object existed.                                              |
| `blocked`   | Configuration, location, key, or authorization prevents safe deletion; operator action is needed. |
| `retryable` | Transient or otherwise unclassified provider failure; deletion was not confirmed.                 |

Every adapter blocks unconfigured locations with `storage_unconfigured` and
foreign locations with `storage_location_mismatch`, without sending those refs
to the provider. Database non-numeric or unsafe integer keys are blocked with
`invalid_key`. The database performs one `DELETE ... WHERE id IN (...) RETURNING
id` through `getEngine().db`; returned ids are deleted, absent ids not found,
and database errors retryable.

S3 uses the existing client and `DeleteObjectsCommand`, at most 1000 keys per
request, with `Quiet: false`. Missing `S3_ACCESS_KEY` or `S3_SECRET_KEY` blocks
deletion with `storage_unconfigured` before calling the SDK, even when the
endpoint and bucket identify a location. Per-key authorization errors are
blocked; other per-key errors are retryable. A key must appear in the response's
`Deleted` list to be acknowledged; keys in neither `Deleted` nor `Errors` are
retryable with `s3_delete_unconfirmed`. Errors take precedence over deletion
acknowledgements. Whole-request authorization errors (including HTTP 401/403,
invalid/expired credentials, and `NoSuchBucket`) are blocked; other failures are
retryable. S3 cannot distinguish a missing object from a deleted object:
acknowledged keys report **deleted**, never **not_found**.

Blob uses `del(pathnames, { token })` in batches of at most 1000. The installed
SDK accepts arrays without imposing its own cap. It returns no per-object
status, so successful deletes also report **deleted**, never **not_found**.
Access/token/store-suspended/store-not-found errors are blocked; other errors
are retryable.

UploadThing uses `UTApi({ token }).deleteFiles(keys)` in batches of at most 500
keys. A fully acknowledged batch is deleted. Only a successful partial batch
(`success === true` and `deletedCount < batch length`) is retried individually.
Thrown batches classify the whole chunk without per-key fallback; unsuccessful
responses are retryable without fallback. Authentication failures, including
the SDK's `ResponseError.response.status` HTTP 401/403, are blocked; other
failures are retryable. An individual successful delete with `deletedCount ===
0` is not found; `success: false` is not evidence of absence. A partial pass is
ambiguous: both keys already deleted by the batch and keys that never existed
can return **not_found** on the individual retry.

The runtime `StoragePort` retains upload/download only. URL/key deletion shims
are removed. The version-delete route keeps its current synchronous behavior
and its current/only-version 409 guards. Before deleting bytes it checks all
documents and other versions for the URL, including stored website-preview URLs
in either row's OCR metadata. Shared bytes are retained while the version row
is removed. Database bytes additionally require `file_uploads.company_id` to
match the caller's workspace; foreign or unstamped files are retained.
The reference guard also retains matching absolute/relative internal-file
aliases while that backfill is in progress; this never expands which origins
`refFromStoredUrl` trusts for deletion.
For an unshared, owned object, unrecognized/ambiguous refs and blocked/retryable
deletes return 502 and retain the version row; deleted/not-found permits cleanup.
Website-preview replacement uses the same global reference guard before
best-effort deletion, so a version's copied preview survives replacement.
Internal signed reads, workspace stamping, and byte-range forwarding are unchanged.

## Ledger

`storage_objects` is the product-owned, durable inventory of newly written
objects. `ledger.ts` accepts the caller's database or transaction executor
(rather than importing the shared database and re-entering storage initialization).
The unique `(adapter, storage_location_id, object_key)` triple is recorded with
`ON CONFLICT DO NOTHING`; a repeated record never changes the original URL,
company stamp or metadata. URL lookups are exact and use a HASH index because
provider URLs can exceed PostgreSQL's btree tuple limit. Ref lookups match all
three identity fields.

The write primitives record the exact URL they return, content type, byte size
and available checksum:

| Writer                          | Source                 | Company stamp                                  |
| ------------------------------- | ---------------------- | ---------------------------------------------- |
| `uploadFile` (S3 or database)   | `upload-file`          | Input company, or null                         |
| `putFile` (Vercel Blob)         | `vercel-blob`          | Required explicit company or null              |
| UploadThing completion callback | `uploadthing`          | Active workspace captured in upload middleware |
| `POST /api/storage/upload`      | `storage-upload-route` | Authorized workspace                           |

Database uploads insert `file_uploads` and the inventory in the same transaction.
Provider writes happen first; a failed inventory insert triggers best-effort
deletion of the new object and fails the write. Unconfirmed compensation is
logged rather than silently leaving bytes behind. UploadThing records and returns
`ufsUrl`, including for private ACL uploads (URL identity does not bypass ACL).
Its company stamp comes from signed callback metadata, not callback cookies.

UploadThing v7.7.4 logs thrown completion errors without sending
`/callback-result`, potentially leaving `awaitServerData` clients pending (the
browser SDK sets no timeout). Therefore a compensated ledger failure returns
typed `{ ok: false, error: "storage_record_failed" }` server data instead.
Success returns `{ ok: true, fileUrl, ... }`; every client checks this union
before persisting the URL and uses its existing upload-failed error path.

`company_id` is nullable and intentionally has **no foreign key**. Neither tenant
nor document deletion may erase the inventory needed to clean up or audit bytes.
There are no document ownership columns: later deletion planning derives
references from relational rows. `deleted_at` is reserved for the deletion
lifecycle. This layer does not backfill old objects.

At document/version upload ingress, recognized S3, Blob and UploadThing URLs
must resolve to an inventory row stamped with the active company. Foreign,
unstamped and missing objects return the same `fileNotInWorkspace` 404.
Database URLs retain their `file_uploads.company_id` check; external links remain
accepted. Consequently legacy unledgered provider objects cannot be attached
through client ingress until migrated; existing server-side re-embedding and
version revert do not create a fresh client reference.

The single unrecorded write path is `POST /api/storage/presign`: it returns a
direct-upload capability but has no completion callback and no repository caller.
Objects uploaded with it remain deletable via URL-to-ref recognition, but are
not in this inventory.
