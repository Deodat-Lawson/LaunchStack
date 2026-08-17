import { randomUUID } from "node:crypto";
import type { DeleteResult, ObjectRef } from "@launchstack/core/storage";

import { env } from "~/env";
import { resolveStorageLocationId } from "~/lib/storage-location-id";

// ---------------------------------------------------------------------------
// StorageError — wraps provider errors with provider name context
// ---------------------------------------------------------------------------

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: Error,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "StorageError";
  }
}

// ---------------------------------------------------------------------------
// Backend resolution
// ---------------------------------------------------------------------------

export type StorageBackend = "s3" | "database";

function s3VarsConfigured(): boolean {
  return Boolean(
    env.server.NEXT_PUBLIC_S3_ENDPOINT &&
      env.server.S3_REGION &&
      env.server.S3_ACCESS_KEY &&
      env.server.S3_SECRET_KEY &&
      env.server.S3_BUCKET_NAME,
  );
}

/**
 * Resolves the active storage backend. Honors an explicit
 * NEXT_PUBLIC_STORAGE_PROVIDER setting; otherwise infers from whether the full
 * set of S3 env vars is present (auto-fallback to Postgres).
 */
export function resolveStorageBackend(): StorageBackend {
  const explicit = env.server.NEXT_PUBLIC_STORAGE_PROVIDER;
  if (explicit === "s3" || explicit === "database") {
    return explicit;
  }
  return s3VarsConfigured() ? "s3" : "database";
}

export function isS3Storage(): boolean {
  return resolveStorageBackend() === "s3";
}

export function isLocalStorage(): boolean {
  return resolveStorageBackend() === "database";
}

// ---------------------------------------------------------------------------
// Upload interface
// ---------------------------------------------------------------------------

export interface UploadInput {
  filename: string;
  data: Buffer | ArrayBuffer | Uint8Array;
  contentType?: string;
  userId: string;
}

export interface UploadResult {
  url: string;
  pathname: string;
  ref: ObjectRef;
  contentType?: string;
  provider: StorageBackend;
}

// ---------------------------------------------------------------------------
// Filename sanitisation (shared with s3-client)
// ---------------------------------------------------------------------------

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function toBuffer(data: Buffer | ArrayBuffer | Uint8Array): Buffer {
  return Buffer.from(
    data instanceof ArrayBuffer ? new Uint8Array(data) : data,
  );
}

// ---------------------------------------------------------------------------
// uploadFile — delegates to the active backend
// ---------------------------------------------------------------------------

export async function uploadFile(input: UploadInput): Promise<UploadResult> {
  const backend = resolveStorageBackend();
  if (backend === "s3") {
    return uploadToS3(input);
  }
  return uploadToDatabase(input);
}

async function uploadToS3(input: UploadInput): Promise<UploadResult> {
  try {
    const { putObject, getObjectUrl, ensureBucketExists } = await import(
      "~/server/storage/s3-client"
    );

    const safeName = sanitizeFilename(input.filename);
    const key = `documents/${randomUUID()}-${safeName || "upload"}`;
    const body = toBuffer(input.data);

    await ensureBucketExists();
    await putObject(key, body, input.contentType);

    return {
      url: getObjectUrl(key),
      pathname: key,
      ref: {
        adapter: "s3",
        storageLocationId: resolveStorageLocationId("s3"),
        key,
      },
      contentType: input.contentType,
      provider: "s3",
    };
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "s3",
      err instanceof Error ? err : undefined,
    );
  }
}

async function uploadToDatabase(input: UploadInput): Promise<UploadResult> {
  try {
    const { db } = await import("~/server/db");
    const { fileUploads } = await import("@launchstack/core/db/schema");

    const body = toBuffer(input.data);
    const safeName = sanitizeFilename(input.filename);
    const pathname = `documents/${randomUUID()}-${safeName || "upload"}`;

    const [row] = await db
      .insert(fileUploads)
      .values({
        userId: input.userId,
        filename: input.filename,
        mimeType: input.contentType ?? "application/octet-stream",
        fileData: body.toString("base64"),
        fileSize: body.length,
        storageProvider: "database",
        storageUrl: null,
        storagePathname: pathname,
      })
      .returning({ id: fileUploads.id });

    if (!row) {
      throw new Error("Insert into fileUploads returned no row");
    }

    return {
      url: `/api/files/${row.id}`,
      pathname,
      ref: {
        adapter: "database",
        storageLocationId: resolveStorageLocationId("database"),
        key: String(row.id),
      },
      contentType: input.contentType,
      provider: "database",
    };
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "database",
      err instanceof Error ? err : undefined,
    );
  }
}

// ---------------------------------------------------------------------------
// getFileUrl — resolve a storage key to a URL
// ---------------------------------------------------------------------------

export function getFileUrl(key: string, provider?: StorageBackend): string {
  const resolvedProvider = provider ?? resolveStorageBackend();

  if (resolvedProvider === "s3") {
    const endpoint =
      env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;
    if (!endpoint) {
      throw new StorageError(
        "NEXT_PUBLIC_S3_ENDPOINT is not configured",
        "s3",
      );
    }
    const bucket = env.server.S3_BUCKET_NAME;
    const base = endpoint.replace(/\/+$/, "");
    return bucket ? `${base}/${bucket}/${key}` : `${base}/${key}`;
  }

  // database: key is already a /api/files/<id> URL
  return key;
}

// ---------------------------------------------------------------------------
// deleteFile — remove an object from storage
// ---------------------------------------------------------------------------

export async function deleteFile(
  keyOrUrl: string,
  provider?: StorageBackend,
): Promise<void> {
  const resolvedProvider = provider ?? resolveStorageBackend();

  if (resolvedProvider === "s3") {
    try {
      const { deleteObject } = await import("~/server/storage/s3-client");
      await deleteObject(keyOrUrl);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        err instanceof Error ? err.message : String(err),
        "s3",
        err instanceof Error ? err : undefined,
      );
    }
    return;
  }

  // database: remove the fileUploads row matching this /api/files/<id> URL
  try {
    const idFromApiUrl = /^(?:https?:\/\/[^/]+)?\/api\/files\/(\d+)$/.exec(keyOrUrl)?.[1];
    const idFromOpaqueKey = /^(\d+)$/.exec(keyOrUrl)?.[1];
    const rawId = idFromApiUrl ?? idFromOpaqueKey;

    if (!rawId) {
      throw new StorageError(
        `Invalid database file reference: ${keyOrUrl}`,
        "database",
      );
    }

    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      throw new StorageError(
        `Invalid database file id: ${rawId}`,
        "database",
      );
    }

    const { db } = await import("~/server/db");
    const { fileUploads } = await import("@launchstack/core/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(fileUploads).where(eq(fileUploads.id, id));
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "database",
      err instanceof Error ? err : undefined,
    );
  }
}

function mapDeleteError(ref: ObjectRef, err: unknown): DeleteResult {
  const message = err instanceof Error ? err.message : String(err);
  const name =
    typeof err === "object" &&
    err &&
    "name" in err &&
    typeof (err as { name?: unknown }).name === "string"
      ? (err as { name: string }).name
      : "delete_failed";

  const providerCode =
    typeof err === "object" &&
    err &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : typeof err === "object" &&
          err &&
          "Code" in err &&
          typeof (err as { Code?: unknown }).Code === "string"
        ? (err as { Code: string }).Code
        : undefined;

  const statusCode =
    typeof err === "object" &&
    err &&
    "$metadata" in err &&
    typeof (err as { $metadata?: { httpStatusCode?: unknown } }).$metadata
      ?.httpStatusCode === "number"
      ? (err as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode
      : typeof err === "object" &&
          err &&
          "statusCode" in err &&
          typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;

  const code = providerCode ?? name;

  if (
    statusCode === 404 ||
    /NoSuchKey|NotFound|BlobNotFound|404/i.test(message) ||
    /NoSuchKey|NotFound|BlobNotFound/i.test(code)
  ) {
    return { ref, outcome: "not_found" };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /AccessDenied|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|AuthFailed|Credentials|Credential|permission/i.test(
      `${code} ${message}`,
    ) ||
    /not configured|unparseable|misconfigured|configuration/i.test(message)
  ) {
    return {
      ref,
      outcome: "blocked",
      errorCode: code,
      message,
    };
  }

  return {
    ref,
    outcome: "retryable",
    errorCode: code,
    message,
  };
}

export async function deleteFileByRef(ref: ObjectRef): Promise<DeleteResult> {
  const adapter = ref.adapter;
  if (
    adapter !== "s3" &&
    adapter !== "database" &&
    adapter !== "vercel-blob" &&
    adapter !== "uploadthing"
  ) {
    return {
      ref,
      outcome: "rejected",
      errorCode: "unsupported_adapter",
      message: `Unsupported storage adapter: ${String(adapter)}`,
    };
  }

  try {
    const expectedLocationId = resolveStorageLocationId(adapter);
    if (ref.storageLocationId !== expectedLocationId) {
      return {
        ref,
        outcome: "blocked",
        errorCode: "storage_location_mismatch",
        message: `Ref storageLocationId (${ref.storageLocationId}) does not match active adapter location (${expectedLocationId}).`,
      };
    }
  } catch (err) {
    return {
      ref,
      outcome: "blocked",
      errorCode: "location_resolution_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    if (adapter === "s3" || adapter === "database") {
      await deleteFile(ref.key, adapter);
    } else if (adapter === "vercel-blob") {
      const { deleteFile: deleteBlobFile } = await import("~/server/storage/vercel-blob");
      await deleteBlobFile(ref.key);
    } else if (adapter === "uploadthing") {
      const { deleteUploadThingFileByKey } = await import("~/server/storage/uploadthing");
      const outcome = await deleteUploadThingFileByKey(ref.key);
      if (outcome.outcome === "retryable") {
        return {
          ref,
          outcome: "retryable",
          errorCode: outcome.errorCode,
          message: outcome.message,
        };
      }
      if (outcome.outcome === "blocked") {
        return {
          ref,
          outcome: "blocked",
          errorCode: outcome.errorCode,
          message: outcome.message,
        };
      }
      if (outcome.outcome === "not_found") {
        return { ref, outcome: "not_found" };
      }
    } else {
      return {
        ref,
        outcome: "rejected",
        errorCode: "unsupported_adapter",
        message: `Unsupported storage adapter: ${adapter}`,
      };
    }

    return { ref, outcome: "deleted" };
  } catch (err) {
    return mapDeleteError(ref, err);
  }
}

/**
 * Batch delete canonical storage refs with stable per-item outcomes.
 *
 * Refs are grouped by (adapter, storageLocationId) to preserve location
 * isolation and to allow adapter-level batching where available.
 */
export async function deleteManyByRef(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
  if (refs.length === 0) {
    return [];
  }

  const grouped = new Map<string, ObjectRef[]>();
  for (const ref of refs) {
    const groupKey = `${ref.adapter}::${ref.storageLocationId}`;
    const current = grouped.get(groupKey);
    if (current) {
      current.push(ref);
    } else {
      grouped.set(groupKey, [ref]);
    }
  }

  const results: DeleteResult[] = [];
  for (const groupRefs of grouped.values()) {
    const first = groupRefs[0];
    if (!first) continue;

    if (first.adapter === "s3") {
      let expectedLocationId: string;
      try {
        expectedLocationId = resolveStorageLocationId("s3");
      } catch (err) {
        for (const ref of groupRefs) {
          results.push({
            ref,
            outcome: "blocked",
            errorCode: "location_resolution_failed",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (first.storageLocationId !== expectedLocationId) {
        for (const ref of groupRefs) {
          results.push({
            ref,
            outcome: "blocked",
            errorCode: "storage_location_mismatch",
            message: `Ref storageLocationId (${ref.storageLocationId}) does not match active adapter location (${expectedLocationId}).`,
          });
        }
        continue;
      }

      const { deleteObjects: deleteObjectsInS3 } = await import("~/server/storage/s3-client");
      const outcomes = await deleteObjectsInS3(groupRefs.map((ref) => ref.key));
      const outcomeByKey = new Map(outcomes.map((outcome) => [outcome.key, outcome] as const));

      for (const ref of groupRefs) {
        const outcome = outcomeByKey.get(ref.key);
        if (!outcome) {
          results.push({
            ref,
            outcome: "retryable",
            errorCode: "missing_delete_outcome",
            message: `No delete outcome returned for key "${ref.key}".`,
          });
          continue;
        }

        results.push({
          ref,
          outcome: outcome.outcome,
          errorCode: outcome.errorCode,
          message: outcome.message,
        });
      }
      continue;
    }

    for (const ref of groupRefs) {
      results.push(await deleteFileByRef(ref));
    }
  }

  return results;
}

export async function deleteObjects(keys: string[]): Promise<DeleteResult[]> {
  if (keys.length === 0) return [];

  const storageLocationId = resolveStorageLocationId("s3");
  const { deleteObjects: deleteObjectsInS3 } = await import(
    "~/server/storage/s3-client"
  );
  const outcomes = await deleteObjectsInS3(keys);

  return outcomes.map((outcome) => ({
    ref: {
      adapter: "s3",
      storageLocationId,
      key: outcome.key,
    },
    outcome: outcome.outcome,
    errorCode: outcome.errorCode,
    message: outcome.message,
  }));
}

/**
 * Delete a historical stored file by its URL, regardless of provider.
 *
 * @deprecated New lifecycle code must call `deleteFileByRef`; this shim is
 * retained only for unmanifested historical rows.
 */
export async function deleteFileByUrl(url: string): Promise<void> {
  if (!url) return;

  const { promoteLegacyUrlToRef } = await import("~/server/storage/legacy-promote");
  const promoted = promoteLegacyUrlToRef({ value: url });
  if (!promoted.ok) {
    throw new StorageError(
      `Ref promotion failed (${promoted.reason})`,
      resolveStorageBackend(),
    );
  }

  const result = await deleteFileByRef(promoted.ref);
  if (result.outcome === "retryable" || result.outcome === "blocked" || result.outcome === "rejected") {
    throw new StorageError(result.message ?? `Delete failed with outcome=${result.outcome}`, promoted.ref.adapter);
  }
}

// ---------------------------------------------------------------------------
// fetchFile — unified retrieval for any storage URL
// ---------------------------------------------------------------------------

export async function fetchFile(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const s3Endpoint =
    env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;

  // S3 URLs — plain fetch
  if (s3Endpoint && url.startsWith(s3Endpoint)) {
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new StorageError(
        `S3 storage unavailable at ${s3Endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        "s3",
        err instanceof Error ? err : undefined,
      );
    }
  }

  // Legacy private Vercel Blob URLs — delegate to fetchBlob for auth
  try {
    const { fetchBlob, isPrivateBlobUrl } = await import(
      "~/server/storage/vercel-blob"
    );
    if (isPrivateBlobUrl(url)) {
      return await fetchBlob(url, init);
    }
  } catch {
    // vercel-blob module unavailable — fall through to plain fetch
  }

  // Public URLs (legacy Vercel Blob, etc.) — plain fetch
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "s3",
      err instanceof Error ? err : undefined,
    );
  }
}
