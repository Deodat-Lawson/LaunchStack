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

export async function putFile({ filename, data, contentType }: PutFileInput): Promise<StoredBlobMetadata> {
  const token = getBlobToken();
  const safeName = sanitizeFilename(filename);
  const key = `documents/${randomUUID()}-${safeName.length > 0 ? safeName : "upload"}`;

  const blob = await put(key, data, {
    access: "public",
    contentType,
    token,
  });

  const extended = blob as PutBlobResult & { contentHash?: string | null };

  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType,
    size: blob.size,
    checksum: extended.contentHash ?? null,
  };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}
