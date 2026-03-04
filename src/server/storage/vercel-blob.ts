import { put, type PutBlobResult } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { env } from "~/env";

export interface PutFileInput {
  filename: string;
  data: ArrayBuffer | Uint8Array | Buffer;
  contentType?: string;
}

export interface StoredBlobMetadata {
  url: string;
  pathname: string;
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

function getBlobToken(): string {
  const token = env.server.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new MissingBlobTokenError();
  }
  return token;
}

let detectedAccess: "public" | "private" | null = null;

export async function putFile({ filename, data, contentType }: PutFileInput): Promise<StoredBlobMetadata> {
  const token = getBlobToken();
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
    contentType: blob.contentType,
    checksum: extended.contentHash ?? null,
  };
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
