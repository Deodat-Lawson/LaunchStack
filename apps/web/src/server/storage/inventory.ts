import "server-only";

import type { ObjectRef } from "@launchstack/core/storage";
import { and, asc, eq, gt, like } from "drizzle-orm";

import { fileUploads } from "@launchstack/core/db/schema";
import { env } from "~/env";
import { resolveStorageLocationId, parseVercelBlobStoreIdFromToken } from "~/lib/storage-location-id";
import { db } from "~/server/db";
import { getS3StorageAdapter } from "~/server/storage/adapters/s3-adapter";

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
    const response = await getS3StorageAdapter().listObjectsPrivileged({
      prefix: input.prefix,
      cursor: input.cursor,
      limit,
    });

    const objects: PrivilegedInventoryObject[] = [];
    for (const entry of response.objects) {
      if (!entry.key) continue;
      objects.push({
        key: entry.key,
        ref: makeRef("s3", input.storageLocationId, entry.key),
        size: entry.size,
        lastModified: entry.lastModified,
        etag: entry.etag,
      });
    }

    return {
      ok: true,
      objects,
      nextCursor: response.nextCursor,
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
 * UploadThing inventory listing (C5).
 *
 * This branch previously returned a hardcoded "unavailable". That was true
 * when it was written and is not true now: UTApi exposes listFiles, so the
 * orphan audit can see UploadThing objects like any other adapter. Reporting
 * "unavailable" for a provider that can in fact list is worse than reporting
 * nothing — C3's audit is told to treat unavailable as *unknown*, so a whole
 * adapter's objects would sit permanently unclassified for no reason.
 *
 * Pagination is offset-based rather than cursor-based, because that is what
 * the provider offers. The cursor is the offset, kept opaque to callers.
 */
async function listUploadThingObjects(
  input: Required<Pick<PrivilegedListObjectsInput, "storageLocationId">> &
    Omit<PrivilegedListObjectsInput, "storageLocationId">,
): Promise<PrivilegedListObjectsResult> {
  const token = env.server.UPLOADTHING_TOKEN ?? process.env.UPLOADTHING_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: {
        kind: "unavailable",
        code: "uploadthing_token_missing",
        message: "UPLOADTHING_TOKEN is not configured.",
      },
    };
  }

  // UploadThing's list API has no prefix filter. Ignoring the prefix would
  // return objects the caller did not ask for and let an audit believe it had
  // scanned a narrower set than it actually did, so this refuses instead of
  // quietly doing something different from what was requested.
  if (input.prefix && input.prefix.length > 0) {
    return {
      ok: false,
      error: {
        kind: "invalid_request",
        code: "uploadthing_prefix_unsupported",
        message:
          "UploadThing listing does not support prefix filtering. Omit prefix, or filter the returned keys.",
      },
    };
  }

  // Order matters. The location guard runs *after* the token check, because
  // resolveStorageLocationId throws when the token is missing or unparseable —
  // and a deployment that simply does not use UploadThing should read as
  // "unavailable" (nothing to see), not "blocked" (a config error a human must
  // fix). Blocked is reserved for a token that exists but points somewhere
  // other than the refs being asked about.
  let expectedLocationId: string;
  try {
    expectedLocationId = resolveStorageLocationId("uploadthing");
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unavailable",
        code: "uploadthing_token_unparseable",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (input.storageLocationId !== expectedLocationId) {
    return locationMismatch(input.storageLocationId, expectedLocationId);
  }

  const limit = clampLimit(input.limit);
  const cursor = input.cursor?.trim();
  const offset = cursor && cursor.length > 0 ? Number.parseInt(cursor, 10) : 0;

  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      error: {
        kind: "invalid_request",
        code: "invalid_cursor",
        message: "Cursor must be a non-negative integer offset for UploadThing inventory scans.",
      },
    };
  }

  try {
    const { UTApi } = await import("uploadthing/server");
    const utapi = new UTApi({ token });
    const listed = await utapi.listFiles({ limit, offset });

    const objects: PrivilegedInventoryObject[] = [];
    for (const file of listed.files) {
      if (!file.key) continue;
      objects.push({
        key: file.key,
        ref: makeRef("uploadthing", input.storageLocationId, file.key),
        size: typeof file.size === "number" ? file.size : undefined,
        // uploadedAt is epoch milliseconds on this API, not a Date.
        lastModified:
          typeof file.uploadedAt === "number"
            ? new Date(file.uploadedAt).toISOString()
            : undefined,
      });
    }

    return {
      ok: true,
      objects,
      // Advance by what the provider returned, not by what survived the
      // keyless filter above — otherwise a single keyless entry rewinds the
      // offset by one and the next page repeats an object forever.
      nextCursor: listed.hasMore ? String(offset + listed.files.length) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // An auth/config failure is permanent and needs a human; everything else
    // is worth retrying. Same split the adapters use.
    if (
      /Unauthorized|Forbidden|AccessDenied|InvalidToken|Credentials|permission|not configured|unparseable/i.test(
        message,
      )
    ) {
      return {
        ok: false,
        error: { kind: "blocked", code: "uploadthing_auth_or_config_error", message },
      };
    }

    return {
      ok: false,
      error: { kind: "retryable", code: "uploadthing_list_failed", message },
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
  // Handled before the shared location resolution below, which throws for an
  // unconfigured UploadThing token. The branch does its own guard in the right
  // order — see listUploadThingObjects.
  if (input.adapter === "uploadthing") {
    return listUploadThingObjects({ ...input, storageLocationId: input.storageLocationId });
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
