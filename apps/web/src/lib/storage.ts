import { randomUUID } from "node:crypto";
import type { DeleteResult, ObjectRef } from "@launchstack/core/storage";

import { internalServiceHeaders } from "~/server/storage/internal-service-auth";

declare const require:
  | ((id: string) => { env?: unknown })
  | undefined;

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

type LegacyEnvShape = {
  server?: Record<string, string | undefined>;
  client?: Record<string, string | undefined>;
};

let cachedEnvModule: LegacyEnvShape | null | undefined;

function readLegacyEnv(name: string): string | undefined {
  if (cachedEnvModule === undefined) {
    try {
      if (typeof require === "function") {
        cachedEnvModule = require("~/env")?.env ?? null;
      } else {
        cachedEnvModule = null;
      }
    } catch {
      cachedEnvModule = null;
    }
  }

  const fromServer = cachedEnvModule?.server?.[name];
  if (fromServer && fromServer.length > 0) return fromServer;

  const fromClient = cachedEnvModule?.client?.[name];
  if (fromClient && fromClient.length > 0) return fromClient;

  return undefined;
}

function readEnv(name: string): string | undefined {
  const legacy = readLegacyEnv(name);
  if (legacy) return legacy;

  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function resolveStorageLocationId(adapter: ObjectRef["adapter"]): string {
  if (adapter === "database") {
    return "database:pdr_file_uploads_v1";
  }

  if (adapter === "s3") {
    const endpoint = readEnv("NEXT_PUBLIC_S3_ENDPOINT");
    const bucket = readEnv("S3_BUCKET_NAME");
    if (!endpoint || !bucket) {
      throw new Error("S3 location id requires NEXT_PUBLIC_S3_ENDPOINT and S3_BUCKET_NAME");
    }
    return `s3:${endpoint}@${bucket}`;
  }

  if (adapter === "vercel-blob") {
    const token = readEnv("BLOB_READ_WRITE_TOKEN");
    const storeId = token?.split("_")[3];
    if (!storeId) {
      throw new Error("Vercel Blob location id requires parseable BLOB_READ_WRITE_TOKEN");
    }
    return `vercel-blob:${storeId}`;
  }

  if (adapter === "uploadthing") {
    const explicit = readEnv("UPLOADTHING_LOCATION_ID");
    if (explicit) return explicit;

    const token = readEnv("UPLOADTHING_TOKEN");
    let appId: string | undefined;
    let region: string | undefined;

    if (token && token.includes(".")) {
      try {
        const payloadB64 = token.split(".")[1];
        if (payloadB64) {
          const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
          const payload = JSON.parse(payloadJson) as { appId?: string; region?: string };
          appId = payload.appId;
          region = payload.region;
        }
      } catch {
        // Fall back to underscore format parsing below.
      }
    }

    if (!appId && token) {
      appId = token.split("_")[3];
    }

    if (!appId) {
      throw new Error("UploadThing location id requires UPLOADTHING_LOCATION_ID or parseable UPLOADTHING_TOKEN");
    }
    return region ? `uploadthing:${appId}@${region}` : `uploadthing:${appId}`;
  }

  throw new Error(`Unsupported adapter for location id resolution: ${adapter}`);
}

function s3VarsConfigured(): boolean {
  return Boolean(
    readEnv("NEXT_PUBLIC_S3_ENDPOINT") &&
      readEnv("S3_REGION") &&
      readEnv("S3_ACCESS_KEY") &&
      readEnv("S3_SECRET_KEY") &&
      readEnv("S3_BUCKET_NAME"),
  );
}

/**
 * Resolves the active storage backend. Honors an explicit
 * NEXT_PUBLIC_STORAGE_PROVIDER setting; otherwise infers from whether the full
 * set of S3 env vars is present (auto-fallback to Postgres).
 */
export function resolveStorageBackend(): StorageBackend {
  const explicit = readEnv("NEXT_PUBLIC_STORAGE_PROVIDER");
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
    const endpoint = readEnv("NEXT_PUBLIC_S3_ENDPOINT");
    if (!endpoint) {
      throw new StorageError(
        "NEXT_PUBLIC_S3_ENDPOINT is not configured",
        "s3",
      );
    }
    const bucket = readEnv("S3_BUCKET_NAME");
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
      let key = keyOrUrl;
      if (/^https?:\/\//i.test(keyOrUrl)) {
        const { promoteLegacyUrlToRef } = await import(
          "~/server/storage/legacy-promote"
        );
        const promoted = promoteLegacyUrlToRef({ value: keyOrUrl });
        if (!promoted.ok) {
          throw new StorageError(
            `Invalid S3 object reference: ${promoted.reason}`,
            "s3",
          );
        }
        if (promoted.ref.adapter !== "s3") {
          throw new StorageError(
            `S3 delete received a ${promoted.ref.adapter} reference`,
            "s3",
          );
        }
        key = promoted.ref.key;
      }

      const { deleteObject } = await import("~/server/storage/s3-client");
      await deleteObject(key);
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
    if (adapter === "database") {
      await deleteFile(ref.key, adapter);
    } else {
      const { createStoragePortTargetFactory } = await import(
        "~/server/storage/create-storage-port"
      );
      return await createStoragePortTargetFactory(resolveStorageBackend())
        .forAdapter(adapter)
        .delete(ref);
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

    if (first.adapter === "database") {
      let expectedLocationId: string;
      try {
        expectedLocationId = resolveStorageLocationId("database");
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

      for (const ref of groupRefs) {
        results.push(await deleteFileByRef(ref));
      }
      continue;
    }

    const { createStoragePortTargetFactory } = await import(
      "~/server/storage/create-storage-port"
    );
    const groupResults = await createStoragePortTargetFactory(resolveStorageBackend())
      .forAdapter(first.adapter)
      .deleteMany(groupRefs);
    results.push(...groupResults);
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

/**
 * True when this URL points back at our own app — a relative path, or an
 * absolute one on APP_PUBLIC_URL's origin. Those are the fetches that hit our
 * own routes with no session cookie (the ingestion/OCR download path), and so
 * the ones that need internal service credentials attached (B8).
 */
function isSelfOriginUrl(url: string): boolean {
  if (url.startsWith("/")) return true;

  const appBase = readEnv("APP_PUBLIC_URL");
  if (!appBase) return false;

  try {
    return new URL(url).origin === new URL(appBase).origin;
  } catch {
    return false;
  }
}

export async function fetchFile(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const s3Endpoint = readEnv("NEXT_PUBLIC_S3_ENDPOINT");

  // Identify ourselves when calling our own endpoints, so the tenant check on
  // /api/files/[id] can tell "the ingestion pipeline" apart from "an anonymous
  // caller walking file ids". Never attached to third-party URLs — a provider
  // has no business seeing this secret.
  if (isSelfOriginUrl(url)) {
    const internalHeaders = internalServiceHeaders();
    if (Object.keys(internalHeaders).length > 0) {
      init = { ...init, headers: { ...(init?.headers ?? {}), ...internalHeaders } };
    }
  }

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
