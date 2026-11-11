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
request, with `Quiet: false`. Per-key authorization errors are blocked; other
per-key errors are retryable. Whole-request authorization errors (including
HTTP 403, invalid/expired credentials, and `NoSuchBucket`) are blocked; other
failures are retryable. S3 deletion cannot distinguish a missing object from a
deleted object: successful requests report **deleted**, never **not_found**.

Blob uses `del(pathnames, { token })` in batches of at most 1000. The installed
SDK accepts arrays without imposing its own cap. It returns no per-object
status, so successful deletes also report **deleted**, never **not_found**.
Access/token/store-suspended/store-not-found errors are blocked; other errors
are retryable.

UploadThing uses `UTApi({ token }).deleteFiles(keys)`. A fully acknowledged batch
is deleted. Partial/unsuccessful batches are retried individually to distinguish
deleted and missing keys. Authentication failures are blocked; other failures
are retryable. An individual successful delete with `deletedCount === 0` is
not found; `success: false` is not evidence of absence.

The runtime `StoragePort` retains upload/download only. URL/key deletion shims
are removed. The version-delete route keeps its current synchronous behavior:
unrecognized/ambiguous refs and blocked/retryable deletes return 502 and retain
the version row; deleted/not-found permits row cleanup. Website-preview cleanup
uses the same contract but remains best-effort, logging non-successes. Internal
signed reads, workspace stamping, and byte-range forwarding are unchanged.
