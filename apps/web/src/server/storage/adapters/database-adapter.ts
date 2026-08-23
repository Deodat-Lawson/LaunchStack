/**
 * Database adapter (C3).
 *
 * The backend where the bytes never leave Postgres: a file's contents live
 * base64-encoded in a file_uploads row, and the ref's key is that row's id.
 * Reached through `getStoragePort().forAdapter("database")`.
 *
 * COPIED, NOT MOVED
 * -----------------
 * put and delete are the logic from lib/storage.ts's database branches,
 * reproduced here. That file is Dev A's this sprint (A3/A4 thin it down to
 * shims), and two people editing one 726-line file produces a merge conflict
 * neither can resolve with confidence. So this is a copy; A3 deletes the
 * original once the port is wired.
 *
 * get(ref) — WHY IT MAKES AN HTTP CALL TO OUR OWN APP
 * ---------------------------------------------------
 * There are two defensible ways to read a database-backed file: query the row
 * directly, or fetch /api/files/{id} over HTTP with internal credentials.
 * Dev A chose the authenticated internal call, and that is what this
 * implements. Two consequences follow, and both are deliberate:
 *
 *  - APP_PUBLIC_URL becomes a hard requirement for this adapter. There is no
 *    silent fallback to a direct row read: quietly switching mechanism when
 *    config is missing is how two code paths drift apart until only one of
 *    them is ever tested. It fails loudly instead.
 *
 *  - Reads pass through the route's serve-gating (B6). A file whose document
 *    has an open deletion request answers 410 even to an internal caller.
 *    That is the correct behaviour — bytes on their way out should not be
 *    readable — but it is a real difference from a raw row read, so it is
 *    stated rather than discovered.
 *
 * The internal service token identifies the caller as *this app*, not as any
 * company, so it bypasses the route's tenant check rather than satisfying it.
 * Without it the ingestion path could not read its own uploads once tenant
 * auth is enforcing.
 */

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { fileUploads } from "@launchstack/core/db/schema";

import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import { db } from "~/server/db";
import { env } from "~/env";
import { resolveStorageLocationId } from "~/lib/storage-location-id";
import { internalServiceHeaders } from "~/server/storage/internal-service-auth";

const ADAPTER = "database" as const;

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function toBuffer(data: Buffer | ArrayBuffer | Uint8Array): Buffer {
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function assertOwnAdapter(ref: ObjectRef): void {
  if (ref.adapter !== ADAPTER) {
    throw new Error(
      `[database-adapter] received a ref for adapter "${ref.adapter}". ` +
        "Use getStoragePort().forAdapter(ref.adapter) to reach the right one.",
    );
  }
}

/**
 * Decision 4 applies here too, even though "the location" is a fixed constant
 * for this adapter — a ref carrying some other location came from a different
 * store and must not be resolved against this one.
 */
function locationMismatch(ref: ObjectRef): string | null {
  const current = resolveStorageLocationId(ADAPTER);
  return ref.storageLocationId === current
    ? null
    : `Ref location ${ref.storageLocationId} does not match the configured database store (${current}).`;
}

/** The ref's key is a file_uploads row id. Anything else is not ours. */
function parseRowId(ref: ObjectRef): number | null {
  if (!/^\d+$/.test(ref.key)) return null;
  const id = Number.parseInt(ref.key, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireAppUrl(): string {
  const base = env.server.APP_PUBLIC_URL;
  if (!base) {
    throw new Error(
      "[database-adapter] APP_PUBLIC_URL is required to read database-backed files. " +
        "Reads go through an authenticated internal call to /api/files/{id}, which " +
        "needs an absolute URL.",
    );
  }
  return base.replace(/\/+$/, "");
}

export function createDatabaseAdapter(): TargetedStoragePort {
  const deleteImpl = async (ref: ObjectRef): Promise<DeleteResult> => {
    assertOwnAdapter(ref);

    const mismatch = locationMismatch(ref);
    if (mismatch) {
      return { ref, outcome: "blocked", errorCode: "storage_location_mismatch", message: mismatch };
    }

    const id = parseRowId(ref);
    if (id === null) {
      // Not transient and not the database's fault — a malformed ref needs a
      // human, so BLOCKED rather than an endless retry.
      return {
        ref,
        outcome: "blocked",
        errorCode: "invalid_database_file_reference",
        message: `Database ref key "${ref.key}" is not a file_uploads row id.`,
      };
    }

    try {
      const removed = await db
        .delete(fileUploads)
        .where(eq(fileUploads.id, id))
        .returning({ id: fileUploads.id });

      // The row count is checked, so "it was already gone" is reported as
      // not_found rather than as a successful delete. lib/storage.ts's
      // database branch does not do this today — it returns success either
      // way, which makes an already-absent object indistinguishable from one
      // this call actually removed (design doc A7 asks for an explicit
      // NOT_FOUND contract). Raised separately for that file; this adapter
      // does not inherit the gap.
      return removed.length === 0
        ? { ref, outcome: "not_found" }
        : { ref, outcome: "deleted" };
    } catch (err) {
      return {
        ref,
        outcome: "retryable",
        errorCode: "database_delete_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return {
    adapter: ADAPTER,
    provider: ADAPTER,

    async put(input: UploadInput): Promise<UploadResult> {
      const body = toBuffer(input.data);
      const safeName = sanitizeFilename(input.filename);
      const pathname = `documents/${randomUUID()}-${safeName || "upload"}`;

      const [row] = await db
        .insert(fileUploads)
        .values({
          // The port's userId is optional; engine-initiated writes carry no
          // end user. "system" matches what the existing port already passes.
          userId: input.userId ?? "system",
          filename: input.filename,
          mimeType: input.contentType ?? "application/octet-stream",
          fileData: body.toString("base64"),
          fileSize: body.length,
          storageProvider: ADAPTER,
          storageUrl: null,
          storagePathname: pathname,
        })
        .returning({ id: fileUploads.id });

      if (!row) throw new Error("[database-adapter] insert into file_uploads returned no row");

      return {
        url: `/api/files/${row.id}`,
        pathname,
        ref: {
          adapter: ADAPTER,
          storageLocationId: resolveStorageLocationId(ADAPTER),
          // The row id is the provider-native key for this backend.
          key: String(row.id),
        },
        contentType: input.contentType,
        provider: ADAPTER,
      };
    },

    async get(ref: ObjectRef, init?: RequestInit): Promise<Response> {
      assertOwnAdapter(ref);

      const mismatch = locationMismatch(ref);
      if (mismatch) throw new Error(`[database-adapter] ${mismatch}`);

      const id = parseRowId(ref);
      if (id === null) {
        throw new Error(
          `[database-adapter] ref key "${ref.key}" is not a file_uploads row id.`,
        );
      }

      // Internal service credentials, not a user session. The route reads this
      // as "the app is asking" and skips its tenant check; serve-gating still
      // applies. Merged after the caller's headers so a caller cannot
      // accidentally overwrite them.
      const headers = {
        ...(init?.headers as Record<string, string> | undefined),
        ...internalServiceHeaders(),
      };

      // Returned as-is, fetch-style: callers check response.ok. A gated or
      // missing file surfaces as a non-ok response, not a thrown error.
      return fetch(`${requireAppUrl()}/api/files/${id}`, { ...init, headers });
    },

    delete: deleteImpl,

    async deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      if (refs.length === 0) return [];
      for (const ref of refs) assertOwnAdapter(ref);

      const results: DeleteResult[] = [];
      const byId = new Map<number, ObjectRef>();

      for (const ref of refs) {
        const mismatch = locationMismatch(ref);
        if (mismatch) {
          results.push({
            ref,
            outcome: "blocked",
            errorCode: "storage_location_mismatch",
            message: mismatch,
          });
          continue;
        }

        const id = parseRowId(ref);
        if (id === null) {
          results.push({
            ref,
            outcome: "blocked",
            errorCode: "invalid_database_file_reference",
            message: `Database ref key "${ref.key}" is not a file_uploads row id.`,
          });
          continue;
        }

        byId.set(id, ref);
      }

      if (byId.size === 0) return results;

      try {
        // Unlike the provider APIs, a SQL delete can report exactly which rows
        // it removed — so every ref gets its true outcome from one statement,
        // with no per-item fallback needed and no guessing.
        const removed = await db
          .delete(fileUploads)
          .where(inArray(fileUploads.id, [...byId.keys()]))
          .returning({ id: fileUploads.id });

        const removedIds = new Set(removed.map((row) => row.id));
        for (const [id, ref] of byId) {
          results.push({ ref, outcome: removedIds.has(id) ? "deleted" : "not_found" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const ref of byId.values()) {
          results.push({
            ref,
            outcome: "retryable",
            errorCode: "database_delete_failed",
            message,
          });
        }
      }

      return results;
    },

    async getSignedUrl(ref: ObjectRef, _opts?: GetSignedUrlOptions): Promise<string> {
      assertOwnAdapter(ref);

      const mismatch = locationMismatch(ref);
      if (mismatch) throw new Error(`[database-adapter] ${mismatch}`);

      const id = parseRowId(ref);
      if (id === null) {
        throw new Error(`[database-adapter] ref key "${ref.key}" is not a file_uploads row id.`);
      }

      // NOT a signed URL, and deliberately not pretending to be one. Database
      // files have no signature scheme; /api/files/{id} is their canonical
      // serve path, and access is decided by the requester's session through
      // the route's tenant check and serve gate — not by anything embedded in
      // the URL. So this is safe to hand to a logged-in browser and useless to
      // hand to a stranger. expiresIn is ignored because nothing here expires.
      return `${requireAppUrl()}/api/files/${id}`;
    },
  };
}
