import { put, type PutBlobResult } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import type { ObjectRef } from "@launchstack/core/storage";

export interface PutFileInput {
  filename: string;
  data: ArrayBuffer | Uint8Array | Buffer;
  contentType?: string;
}

export interface StoredBlobMetadata {
  url: string;
  pathname: string;
  ref: ObjectRef;
  contentType?: string;
  size?: number;
  checksum?: string | null;
}

class MissingBlobTokenError extends Error {
  constructor() {
    super("BLOB_READ_WRITE_TOKEN is not configured. Set it in your Vercel project settings.");
    this.name = "MissingBlobTokenError";
  }
}

class UnparseableBlobTokenError extends Error {
  constructor() {
    super("BLOB_READ_WRITE_TOKEN is unparseable (expected token.split(\"_\")[3]).");
    this.name = "UnparseableBlobTokenError";
  }
}

function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new MissingBlobTokenError();
  }
  return token;
}

function getBlobStoreId(token: string): string {
  const parts = token.split("_");
  const storeId = parts[3];
  if (!storeId) {
    throw new UnparseableBlobTokenError();
  }
  return storeId;
}

function storageLocationIdForVercelBlob(storeId: string): string {
  return `vercel-blob:${storeId}`;
}

let detectedAccess: "public" | "private" | null = null;

export async function putFile({ filename, data, contentType }: PutFileInput): Promise<StoredBlobMetadata> {
  const token = getBlobToken();
  const storeId = getBlobStoreId(token);
  const safeName = sanitizeFilename(filename);
  const key = `documents/${randomUUID()}-${safeName.length > 0 ? safeName : "upload"}`;

  const body = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);

  const tryPut = (access: "public" | "private") =>
    put(key, body, { access, contentType, token });

  let blob: PutBlobResult;
  if (detectedAccess) {
    blob = await tryPut(detectedAccess);
  } else {
    try {
      blob = await tryPut("public");
      detectedAccess = "public";
    } catch (err) {
      if (err instanceof Error && err.message.includes("private store")) {
        blob = await tryPut("private");
        detectedAccess = "private";
      } else {
        throw err;
      }
    }
  }

  const extended = blob as PutBlobResult & { contentHash?: string | null };

  return {
    url: blob.url,
    pathname: blob.pathname,
    ref: {
      adapter: "vercel-blob",
      storageLocationId: storageLocationIdForVercelBlob(storeId),
      key: blob.pathname,
    },
    contentType: blob.contentType,
    checksum: extended.contentHash ?? null,
  };
}

export async function deleteFile(pathname: string): Promise<void> {
  const token = getBlobToken();
  const { del } = await import("@vercel/blob");
  await del(pathname, { token });
}

export async function deleteFiles(pathnames: readonly string[]): Promise<void> {
  if (pathnames.length === 0) {
    return;
  }

  const token = getBlobToken();
  const { del } = await import("@vercel/blob");
  await del([...pathnames], { token });
}

export function isPrivateBlobUrl(url: string): boolean {
  return url.includes(".private.blob.");
}

export async function fetchBlob(url: string, init?: RequestInit): Promise<Response> {
  if (isPrivateBlobUrl(url)) {
    const token = getBlobToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
  }
  return fetch(url, init);
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}
