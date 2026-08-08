import "server-only";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { ObjectRef } from "@launchstack/core/storage";
import { and, asc, eq, gt, like } from "drizzle-orm";

import { fileUploads } from "@launchstack/core/db/schema";
import { env } from "~/env";
import { resolveStorageLocationId, parseVercelBlobStoreIdFromToken } from "~/lib/storage-location-id";
import { db } from "~/server/db";
import { getS3BucketName, getS3Client } from "~/server/storage/s3-client";

export interface PrivilegedListObjectsInput {
  adapter: ObjectRef["adapter"];
  storageLocationId: string;
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface PrivilegedInventoryObject {
  key: string;
  ref: ObjectRef;
  size?: number;
  lastModified?: string;
  etag?: string;
}

export type PrivilegedListObjectsErrorKind =
  | "unavailable"
  | "blocked"
  | "invalid_request"
  | "retryable";

export interface PrivilegedListObjectsError {
  kind: PrivilegedListObjectsErrorKind;
  code: string;
  message: string;
}

export type PrivilegedListObjectsResult =
  | {
      ok: true;
      objects: PrivilegedInventoryObject[];
      nextCursor?: string;
    }
  | {
      ok: false;
      error: PrivilegedListObjectsError;
    };

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function clampLimit(input?: number): number {
  if (!Number.isFinite(input)) return DEFAULT_LIMIT;
  const value = Math.floor(input ?? DEFAULT_LIMIT);
  if (value < 1) return 1;
  if (value > MAX_LIMIT) return MAX_LIMIT;
  return value;
}

function locationMismatch(refLocationId: string, expectedLocationId: string): PrivilegedListObjectsResult {
  return {
    ok: false,
    error: {
      kind: "blocked",
      code: "storage_location_mismatch",
      message: `Requested storageLocationId (${refLocationId}) does not match active adapter location (${expectedLocationId}).`,
    },
  };
}

function makeRef(
  adapter: ObjectRef["adapter"],
  storageLocationId: string,
  key: string,
): ObjectRef {
  return { adapter, storageLocationId, key };
}

async function listS3Objects(input: Required<Pick<PrivilegedListObjectsInput, "storageLocationId">> & Omit<PrivilegedListObjectsInput, "storageLocationId">): Promise<PrivilegedListObjectsResult> {
  const limit = clampLimit(input.limit);

  try {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: getS3BucketName(),
        Prefix: input.prefix,
        ContinuationToken: input.cursor,
        MaxKeys: limit,
      }),
    );

    const objects: PrivilegedInventoryObject[] = [];
    for (const entry of response.Contents ?? []) {
      if (!entry.Key) continue;
      objects.push({
        key: entry.Key,
        ref: makeRef("s3", input.storageLocationId, entry.Key),
        size: typeof entry.Size === "number" ? entry.Size : undefined,
        lastModified: entry.LastModified?.toISOString(),
        etag: entry.ETag,
      });
    }

    return {
      ok: true,
      objects,
      nextCursor: response.IsTruncated ? response.NextContinuationToken : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "retryable",
        code: "s3_list_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function listVercelBlobObjects(input: Required<Pick<PrivilegedListObjectsInput, "storageLocationId">> & Omit<PrivilegedListObjectsInput, "storageLocationId">): Promise<PrivilegedListObjectsResult> {
  const token = env.server.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: {
        kind: "unavailable",
        code: "blob_token_missing",
        message: "BLOB_READ_WRITE_TOKEN is not configured.",
      },
    };
  }

  const storeId = parseVercelBlobStoreIdFromToken(token);
  if (!storeId) {
    return {
      ok: false,
      error: {
        kind: "unavailable",
        code: "blob_token_unparseable",
        message: "BLOB_READ_WRITE_TOKEN is unparseable (expected token.split(\"_\")[3]).",
      },
    };
  }

  const expectedLocationId = resolveStorageLocationId("vercel-blob");
  if (input.storageLocationId !== expectedLocationId) {
    return locationMismatch(input.storageLocationId, expectedLocationId);
  }

  const limit = clampLimit(input.limit);

  try {
    const blobSdk = (await import("@vercel/blob")) as {
      list: (options: {
        token: string;
        prefix?: string;
        cursor?: string;
        limit?: number;
      }) => Promise<unknown>;
    };

    const listed = await blobSdk.list({
      token,
      prefix: input.prefix,
      cursor: input.cursor,
      limit,
    });

    const rawBlobs =
      typeof listed === "object" && listed !== null && Array.isArray((listed as { blobs?: unknown }).blobs)
        ? (listed as { blobs: Array<Record<string, unknown>> }).blobs
        : [];

    const objects: PrivilegedInventoryObject[] = [];
    for (const blob of rawBlobs) {
      const key = typeof blob.pathname === "string" ? blob.pathname : null;
      if (!key) continue;

      const uploadedAt = blob.uploadedAt;
      const uploadedAtIso =
        uploadedAt instanceof Date
          ? uploadedAt.toISOString()
          : typeof uploadedAt === "string"
            ? uploadedAt
            : undefined;

      objects.push({
        key,
        ref: makeRef("vercel-blob", input.storageLocationId, key),
        size: typeof blob.size === "number" ? blob.size : undefined,
        lastModified: uploadedAtIso,
        etag: typeof blob.etag === "string" ? blob.etag : undefined,
      });
    }

    const hasMore =
      typeof listed === "object" && listed !== null && (listed as { hasMore?: unknown }).hasMore === true;
    const nextCursor =
      hasMore &&
      typeof (listed as { cursor?: unknown }).cursor === "string" &&
      (listed as { cursor: string }).cursor.length > 0
        ? (listed as { cursor: string }).cursor
        : undefined;

    return {
      ok: true,
      objects,
      nextCursor,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not supported|unsupported|disabled/i.test(message)) {
      return {
        ok: false,
        error: {
          kind: "unavailable",
          code: "blob_listing_unavailable",
          message,
        },
      };
    }

    return {
      ok: false,
      error: {
        kind: "retryable",
        code: "blob_list_failed",
        message,
      },
    };
  }
}

async function listDatabaseObjects(input: Required<Pick<PrivilegedListObjectsInput, "storageLocationId">> & Omit<PrivilegedListObjectsInput, "storageLocationId">): Promise<PrivilegedListObjectsResult> {
  const expectedLocationId = resolveStorageLocationId("database");
  if (input.storageLocationId !== expectedLocationId) {
    return locationMismatch(input.storageLocationId, expectedLocationId);
  }

  const limit = clampLimit(input.limit);
  const cursor = input.cursor?.trim();
  const cursorId = cursor && cursor.length > 0 ? Number.parseInt(cursor, 10) : null;

  if (cursor && (cursorId == null || Number.isNaN(cursorId) || cursorId <= 0)) {
    return {
      ok: false,
      error: {
        kind: "invalid_request",
        code: "invalid_cursor",
        message: "Cursor must be a positive integer for database inventory scans.",
      },
    };
  }

  try {
    const predicates = [eq(fileUploads.storageProvider, "database")];
    if (cursorId != null) {
      predicates.push(gt(fileUploads.id, cursorId));
    }
    if (input.prefix && input.prefix.length > 0) {
      predicates.push(like(fileUploads.storagePathname, `${input.prefix}%`));
    }

    const rows = await db
      .select({
        id: fileUploads.id,
        fileSize: fileUploads.fileSize,
        createdAt: fileUploads.createdAt,
      })
      .from(fileUploads)
      .where(and(...predicates))
      .orderBy(asc(fileUploads.id))
      .limit(limit);

    const objects: PrivilegedInventoryObject[] = rows.map((row) => ({
      key: String(row.id),
      ref: makeRef("database", input.storageLocationId, String(row.id)),
      size: row.fileSize,
      lastModified: row.createdAt?.toISOString(),
    }));

    const nextCursor = rows.length === limit ? String(rows[rows.length - 1]!.id) : undefined;

    return {
      ok: true,
      objects,
      nextCursor,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "retryable",
        code: "database_list_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Privileged object inventory listing for storage-audit tooling.
 *
 * Server-only and intentionally not part of StoragePort.
 */
export async function listObjectsPrivileged(
  input: PrivilegedListObjectsInput,
): Promise<PrivilegedListObjectsResult> {
  if (input.adapter === "uploadthing") {
    return {
      ok: false,
      error: {
        kind: "unavailable",
        code: "uploadthing_list_unavailable",
        message: "UploadThing object listing is unavailable in this runtime.",
      },
    };
  }

  let expectedLocationId: string;
  try {
    expectedLocationId = resolveStorageLocationId(input.adapter);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "blocked",
        code: "location_resolution_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (input.storageLocationId !== expectedLocationId) {
    return locationMismatch(input.storageLocationId, expectedLocationId);
  }

  const normalizedInput = {
    ...input,
    storageLocationId: expectedLocationId,
  };

  if (input.adapter === "s3") {
    return listS3Objects(normalizedInput);
  }

  if (input.adapter === "vercel-blob") {
    return listVercelBlobObjects(normalizedInput);
  }

  if (input.adapter === "database") {
    return listDatabaseObjects(normalizedInput);
  }

  return {
    ok: false,
    error: {
      kind: "unavailable",
      code: "adapter_list_unavailable",
      message: `Object listing is unavailable for adapter "${input.adapter}".`,
    },
  };
}
