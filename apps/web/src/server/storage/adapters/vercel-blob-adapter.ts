/**
 * Vercel Blob adapter (C1).
 *
 * One of the concrete implementations behind TargetedStoragePort. Callers
 * reach it through `getStoragePort().forAdapter("vercel-blob")` and never
 * import this file — that indirection is the entire point of the sprint.
 *
 * WHAT MOVED, AND WHAT IS NEW
 * ---------------------------
 * put / delete / deleteMany are the existing logic from
 * ~/server/storage/vercel-blob.ts, unchanged in behaviour. That file stays in
 * place for now: several call sites still import it directly, and removing
 * those imports is Dev A's A5/A6, not this task. Extract first, delete later.
 *
 * get(ref) is genuinely new, and it is the interesting part of C1.
 *
 * WHY get(ref) NEEDED NEW CODE
 * ----------------------------
 * An ObjectRef carries `key`, which for this adapter is the blob's *pathname*
 * ("documents/uuid-name.pdf"). Reading a blob needs its full URL, and the old
 * code decided whether to attach an Authorization header by string-matching
 * ".private.blob." inside that URL. Neither of those is available from a ref.
 *
 * The wrong fix is to rebuild the URL from the store id. That is exactly the
 * URL-guessing that caused the original P0 deletion bug, and it cannot work
 * anyway: public and private stores use different hostnames, and a ref does
 * not say which kind it came from.
 *
 * The right fix is to ask the provider. @vercel/blob exposes
 * `get(pathname, { access, token })`, which resolves the pathname itself and —
 * per its own docs — sets the authorization header automatically for private
 * blobs. So the private/public handling that used to leak out through
 * isPrivateBlobUrl now lives entirely inside this file, which is what lets
 * A6 drop its direct vercel-blob.ts imports.
 *
 * ACCESS DETECTION
 * ----------------
 * A store is either public or private, and nothing in the ref or the env says
 * which. The existing put() already solves this by trying "public", catching
 * the "private store" error, and caching the answer in module state. get()
 * uses the same cache and the same fallback rather than inventing a second
 * mechanism. First read in a fresh process may cost one extra call; after that
 * it is free.
 */

import { randomUUID } from "node:crypto";

import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

const ADAPTER = "vercel-blob" as const;

type BlobAccess = "public" | "private";

/**
 * Cached per process. Shared by put and get on purpose — they are asking the
 * same question about the same store.
 */
let detectedAccess: BlobAccess | null = null;

class MissingBlobTokenError extends Error {
  constructor() {
    super("BLOB_READ_WRITE_TOKEN is not configured. Set it in your Vercel project settings.");
    this.name = "MissingBlobTokenError";
  }
}

class UnparseableBlobTokenError extends Error {
  constructor() {
    super('BLOB_READ_WRITE_TOKEN is unparseable (expected token.split("_")[3]).');
    this.name = "UnparseableBlobTokenError";
  }
}

function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new MissingBlobTokenError();
  return token;
}

/**
 * The store id is parsed the same way the SDK does it. Frozen at upload time
 * into storageLocationId, so a token rotation within one store keeps old refs
 * valid while a token for a *different* store correctly invalidates them.
 */
function getBlobStoreId(token: string): string {
  const storeId = token.split("_")[3];
  if (!storeId) throw new UnparseableBlobTokenError();
  return storeId;
}

function storageLocationIdForVercelBlob(storeId: string): string {
  return `vercel-blob:${storeId}`;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function isAuthOrConfigError(text: string): boolean {
  return /Unauthorized|Forbidden|AccessDenied|InvalidToken|token|Credentials|permission|not configured|unparseable|suspended|not found store/i.test(
    text,
  );
}

/**
 * Copy provider response headers into a plain [key, value][].
 *
 * @vercel/blob returns undici's Headers, which is a *different declared type*
 * from the global Headers this project's Response constructor expects, even
 * though at runtime they are the same thing. TypeScript compares them
 * structurally, finds their iterators disagree, and refuses — so passing one
 * straight through fails to compile.
 *
 * The parameter is typed by the single method we actually use rather than by
 * either Headers type, so this keeps working whichever one the caller hands
 * us, and needs no cast.
 */
function toHeaderEntries(headers: {
  forEach(cb: (value: string, key: string) => void): void;
}): [string, string][] {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
}

/** A ref from another adapter reaching this file is a programming error. */
function assertOwnAdapter(ref: ObjectRef): void {
  if (ref.adapter !== ADAPTER) {
    throw new Error(
      `[vercel-blob-adapter] received a ref for adapter "${ref.adapter}". ` +
        "Use getStoragePort().forAdapter(ref.adapter) to reach the right one.",
    );
  }
}

/**
 * Decision 4: a ref names the store it was minted against. If that no longer
 * matches the configured store, the object we would touch is a *different*
 * object that happens to share a pathname. Refuse rather than guess.
 */
function locationMatches(ref: ObjectRef, storeId: string): boolean {
  return ref.storageLocationId === storageLocationIdForVercelBlob(storeId);
}

export function createVercelBlobAdapter(): TargetedStoragePort {
  /**
   * Hoisted rather than written as a method so deleteMany can call it without
   * `this`. A port handle gets passed around and destructured; a method that
   * silently depends on its receiver is a trap waiting for the first caller
   * who writes `const { deleteMany } = port`.
   */
  const deleteImpl = async (ref: ObjectRef): Promise<DeleteResult> => {
    assertOwnAdapter(ref);

    let storeId: string;
    try {
      storeId = getBlobStoreId(getBlobToken());
    } catch (err) {
      return {
        ref,
        outcome: "blocked",
        errorCode: "vercel_blob_token_unavailable",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (!locationMatches(ref, storeId)) {
      return {
        ref,
        outcome: "blocked",
        errorCode: "storage_location_mismatch",
        message:
          `Ref location ${ref.storageLocationId} does not match the configured store ` +
          `(${storageLocationIdForVercelBlob(storeId)}).`,
      };
    }

    try {
      const { del } = await import("@vercel/blob");
      await del(ref.key, { token: getBlobToken() });

      // NOTE: "not_found" is unreachable for this adapter. Vercel Blob's del
      // is idempotent and returns void — deleting something that was already
      // gone is indistinguishable from deleting something that was there.
      // Both are terminal and both mean "the bytes are not in the store", so
      // the lifecycle converges either way. Reporting a "not_found" we did
      // not actually observe would be a lie.
      return { ref, outcome: "deleted" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ref,
        outcome: isAuthOrConfigError(message) ? "blocked" : "retryable",
        errorCode: "vercel_blob_delete_failed",
        message,
      };
    }
  };

  return {
    adapter: ADAPTER,
    provider: ADAPTER,

    async put(input: UploadInput): Promise<UploadResult> {
      const { put } = await import("@vercel/blob");
      const token = getBlobToken();
      const storeId = getBlobStoreId(token);

      const safeName = sanitizeFilename(input.filename);
      const key = `documents/${randomUUID()}-${safeName.length > 0 ? safeName : "upload"}`;
      const body = Buffer.from(
        input.data instanceof ArrayBuffer ? new Uint8Array(input.data) : input.data,
      );

      const tryPut = (access: BlobAccess) =>
        put(key, body, { access, contentType: input.contentType, token });

      let blob;
      if (detectedAccess) {
        blob = await tryPut(detectedAccess);
      } else {
        try {
          blob = await tryPut("public");
          detectedAccess = "public";
        } catch (err) {
          // The only failure we translate: a private store rejects a public
          // write with a specific message. Anything else is a real error.
          if (err instanceof Error && err.message.includes("private store")) {
            blob = await tryPut("private");
            detectedAccess = "private";
          } else {
            throw err;
          }
        }
      }

      return {
        url: blob.url,
        pathname: blob.pathname,
        ref: {
          adapter: ADAPTER,
          storageLocationId: storageLocationIdForVercelBlob(storeId),
          // The provider's own name for the object. Never derived from a URL.
          key: blob.pathname,
        },
        contentType: blob.contentType,
        provider: ADAPTER,
      };
    },

    async get(ref: ObjectRef, init?: RequestInit): Promise<Response> {
      assertOwnAdapter(ref);

      const { get, BlobNotFoundError } = await import("@vercel/blob");
      const token = getBlobToken();
      const storeId = getBlobStoreId(token);

      if (!locationMatches(ref, storeId)) {
        throw new Error(
          `[vercel-blob-adapter] ref location ${ref.storageLocationId} does not match the ` +
            `configured store (${storageLocationIdForVercelBlob(storeId)}). Refusing to read ` +
            "a same-pathname object from a different store.",
        );
      }

      // Only headers are forwarded. The SDK owns the request otherwise — it
      // sets authorization for private blobs itself, which is the reason this
      // goes through the SDK rather than a raw fetch.
      const headers = init?.headers;

      const attempt = async (access: BlobAccess) =>
        get(ref.key, { access, token, ...(headers ? { headers } : {}) });

      const order: BlobAccess[] = detectedAccess
        ? [detectedAccess, detectedAccess === "public" ? "private" : "public"]
        : ["public", "private"];

      let lastError: unknown;
      for (const access of order) {
        try {
          const result = await attempt(access);

          // null means the store answered "no such blob" without throwing.
          if (!result) {
            return new Response(null, { status: 404, statusText: "Blob not found" });
          }

          detectedAccess = access;

          // 304: the caller sent ifNoneMatch and the blob is unchanged.
          if (result.statusCode !== 200) {
            return new Response(null, {
              status: result.statusCode,
              headers: toHeaderEntries(result.headers),
            });
          }

          return new Response(result.stream as unknown as BodyInit, {
            status: 200,
            headers: toHeaderEntries(result.headers),
          });
        } catch (err) {
          if (err instanceof BlobNotFoundError) {
            return new Response(null, { status: 404, statusText: "Blob not found" });
          }
          lastError = err;
          // Fall through and try the other access mode once — this is the
          // "wrong guess about the store" case, not a real failure.
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`[vercel-blob-adapter] could not read ${ref.key}`);
    },

    delete: deleteImpl,

    async deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      if (refs.length === 0) return [];
      for (const ref of refs) assertOwnAdapter(ref);

      // Split first: a stale-location ref must not ride along in a bulk call
      // that would delete a same-pathname object out of the current store.
      let storeId: string | null = null;
      try {
        storeId = getBlobStoreId(getBlobToken());
      } catch {
        storeId = null;
      }

      const deletable = storeId ? refs.filter((ref) => locationMatches(ref, storeId)) : [];
      const deletableSet = new Set(deletable);
      const refused = refs.filter((ref) => !deletableSet.has(ref));

      const results: DeleteResult[] = refused.map((ref) => ({
        ref,
        outcome: "blocked" as const,
        errorCode: storeId ? "storage_location_mismatch" : "vercel_blob_token_unavailable",
        message: storeId
          ? `Ref location ${ref.storageLocationId} does not match the configured store.`
          : "BLOB_READ_WRITE_TOKEN is not configured or unparseable.",
      }));

      if (deletable.length === 0) return results;

      try {
        const { del } = await import("@vercel/blob");
        await del(
          deletable.map((ref) => ref.key),
          { token: getBlobToken() },
        );
        for (const ref of deletable) results.push({ ref, outcome: "deleted" });
      } catch {
        // The bulk call gives no per-item detail, so a partial failure would
        // otherwise be reported as total failure — the "all-or-nothing lie"
        // the design doc's A7 warns about. Retry individually so each ref
        // gets the outcome that is actually true for it.
        for (const ref of deletable) {
          results.push(await deleteImpl(ref));
        }
      }

      return results;
    },

    async getSignedUrl(ref: ObjectRef, _opts?: GetSignedUrlOptions): Promise<string> {
      assertOwnAdapter(ref);

      const { head } = await import("@vercel/blob");
      const token = getBlobToken();
      const storeId = getBlobStoreId(token);

      if (!locationMatches(ref, storeId)) {
        throw new Error(
          `[vercel-blob-adapter] ref location ${ref.storageLocationId} does not match the ` +
            "configured store.",
        );
      }

      // Vercel Blob has no signing API. A public blob's URL is already
      // shareable and needs no signature, so returning it is honest. A private
      // blob's URL is NOT shareable — it only works with an Authorization
      // header — so handing one back as a "signed URL" would be a URL that
      // silently 401s for whoever receives it. Fail loudly instead and let the
      // caller stream the bytes through get(ref).
      const meta = await head(ref.key, { token });

      if (detectedAccess === "private") {
        throw new Error(
          "[vercel-blob-adapter] private Vercel Blob stores do not support signed URLs. " +
            "Use get(ref) to stream the bytes through the app instead.",
        );
      }

      return meta.url;
    },
  };
}
