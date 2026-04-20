import { randomUUID } from "node:crypto";

import { env } from "~/env";

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
    const { fileUploads } = await import("~/server/db/schema");

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
    const match = /\/api\/files\/(\d+)/.exec(keyOrUrl);
    if (!match?.[1]) return;
    const id = parseInt(match[1], 10);
    if (isNaN(id)) return;
    const { db } = await import("~/server/db");
    const { fileUploads } = await import("~/server/db/schema");
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

/**
 * Delete a stored file by its URL, regardless of provider.
 *
 * This is the friendlier counterpart to `deleteFile(key, provider)` — most
 * callers only have the URL stored in the DB (e.g. `document_versions.url`)
 * and don't know which provider put it there. This helper inspects the URL,
 * strips the SeaweedFS endpoint prefix to recover the object key when needed,
 * and dispatches to `deleteFile` with the correct provider.
 *
 * Database-backed URLs (`/api/files/{id}`) are silently ignored because there
 * is nothing to delete from a blob provider — the row itself is the storage.
 */
export async function deleteFileByUrl(url: string): Promise<void> {
  if (!url) return;

  // Database-backed storage: nothing to delete at the blob layer.
  if (url.startsWith("/api/files/")) return;

  const s3Endpoint =
    env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;

  if (s3Endpoint && url.startsWith(s3Endpoint)) {
    // SeaweedFS is S3-compatible; recover the object key from the endpoint prefix.
    // e.g. "http://localhost:8333/pdr-documents/documents/abc-file.pdf"
    //   -> "pdr-documents/documents/abc-file.pdf"
    const key = url.slice(s3Endpoint.replace(/\/+$/, "").length + 1);
    return deleteFile(key, "s3");
  }

  // Vercel Blob has no delete handler wired up; fall through as a no-op via
  // the database branch (the regex won't match a blob URL).
  return deleteFile(url, "database");
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
