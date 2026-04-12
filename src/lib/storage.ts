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
// Provider helpers
// ---------------------------------------------------------------------------

export function getStorageProvider(): "cloud" | "local" {
  return (env.server.NEXT_PUBLIC_STORAGE_PROVIDER as "cloud" | "local") ?? "cloud";
}

export function isLocalStorage(): boolean {
  return getStorageProvider() === "local";
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
  provider: "uploadthing" | "vercel_blob" | "seaweedfs";
}

// ---------------------------------------------------------------------------
// Filename sanitisation (shared with vercel-blob.ts)
// ---------------------------------------------------------------------------

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

// ---------------------------------------------------------------------------
// uploadFile — delegates to the active provider
// ---------------------------------------------------------------------------

export async function uploadFile(input: UploadInput): Promise<UploadResult> {
  if (isLocalStorage()) {
    return uploadToS3(input);
  }
  return uploadToCloud(input);
}

async function uploadToS3(input: UploadInput): Promise<UploadResult> {
  try {
    const { putObject, getObjectUrl, ensureBucketExists } = await import("~/server/storage/s3-client");

    const safeName = sanitizeFilename(input.filename);
    const key = `documents/${randomUUID()}-${safeName || "upload"}`;
    const body = Buffer.from(
      input.data instanceof ArrayBuffer ? new Uint8Array(input.data) : input.data,
    );

    await ensureBucketExists();
    await putObject(key, body, input.contentType);

    return {
      url: getObjectUrl(key),
      pathname: key,
      contentType: input.contentType,
      provider: "seaweedfs",
    };
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "seaweedfs",
      err instanceof Error ? err : undefined,
    );
  }
}

async function uploadToCloud(input: UploadInput): Promise<UploadResult> {
  try {
    const { putFile } = await import("~/server/storage/vercel-blob");

    const result = await putFile({
      filename: input.filename,
      data: input.data,
      contentType: input.contentType,
    });

    return {
      url: result.url,
      pathname: result.pathname,
      contentType: result.contentType,
      provider: "vercel_blob",
    };
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "vercel_blob",
      err instanceof Error ? err : undefined,
    );
  }
}

// ---------------------------------------------------------------------------
// getFileUrl — resolve a storage key to a URL
// ---------------------------------------------------------------------------

export function getFileUrl(key: string, provider?: string): string {
  const resolvedProvider = provider ?? (isLocalStorage() ? "seaweedfs" : "vercel_blob");

  if (resolvedProvider === "seaweedfs") {
    const endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;
    if (!endpoint) {
      throw new StorageError(
        "NEXT_PUBLIC_S3_ENDPOINT is not configured",
        "seaweedfs",
      );
    }
    return `${endpoint.replace(/\/+$/, "")}/${key}`;
  }

  // For cloud providers the key is typically already a full URL
  return key;
}

// ---------------------------------------------------------------------------
// deleteFile — remove an object from storage
// ---------------------------------------------------------------------------

export async function deleteFile(key: string, provider?: string): Promise<void> {
  const resolvedProvider = provider ?? (isLocalStorage() ? "seaweedfs" : "vercel_blob");

  if (resolvedProvider === "seaweedfs") {
    try {
      const { deleteObject } = await import("~/server/storage/s3-client");
      await deleteObject(key);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        err instanceof Error ? err.message : String(err),
        "seaweedfs",
        err instanceof Error ? err : undefined,
      );
    }
    return;
  }

  // Cloud: key is a full Vercel Blob URL
  try {
    const { del } = await import("@vercel/blob");
    await del(key);
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "vercel_blob",
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
    // SeaweedFS stores objects by key; recover it from the endpoint prefix.
    // e.g. "http://localhost:8333/pdr-documents/documents/abc-file.pdf"
    //   -> "pdr-documents/documents/abc-file.pdf"
    const key = url.slice(s3Endpoint.replace(/\/+$/, "").length + 1);
    return deleteFile(key, "seaweedfs");
  }

  // Cloud (Vercel Blob) accepts the full URL as its "key".
  return deleteFile(url, "vercel_blob");
}

// ---------------------------------------------------------------------------
// fetchFile — unified retrieval for any storage provider
// ---------------------------------------------------------------------------

export async function fetchFile(url: string, init?: RequestInit): Promise<Response> {
  const s3Endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;

  // SeaweedFS URLs — plain fetch (no special auth)
  if (s3Endpoint && url.startsWith(s3Endpoint)) {
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new StorageError(
        `Local storage service unavailable at ${s3Endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        "seaweedfs",
        err instanceof Error ? err : undefined,
      );
    }
  }

  // Cloud URLs — delegate to fetchBlob (handles private blob auth)
  try {
    const { fetchBlob } = await import("~/server/storage/vercel-blob");
    return await fetchBlob(url, init);
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError(
      err instanceof Error ? err.message : String(err),
      "vercel_blob",
      err instanceof Error ? err : undefined,
    );
  }
}
