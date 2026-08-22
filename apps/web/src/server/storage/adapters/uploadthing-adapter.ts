/**
 * UploadThing adapter (C2).
 *
 * Reached through `getStoragePort().forAdapter("uploadthing")`. Like the
 * Vercel Blob adapter, this is a fixed single-vendor backend: UploadThing has
 * no open protocol, so unlike S3 there is nothing here to point at a
 * different endpoint via config.
 *
 * SCOPE — READ THIS BEFORE EXTENDING IT
 * -------------------------------------
 * In scope (C2): server-side ref minting, get, delete, deleteMany,
 * getSignedUrl.
 *
 * Explicitly OUT of scope: the browser upload flow. api/uploadthing/core.ts
 * and its route keep using UploadThing's own client SDK, because that upload
 * happens in the user's browser and never passes through this server-side
 * port at all. Routing it through here is not a smaller version of the same
 * thing — it is a different mechanism wearing a similar name.
 *
 * server/storage/uploadthing.ts is left untouched: lib/storage.ts and the
 * upload callback both still import it, and those call sites belong to Dev A.
 * The delete logic below is therefore a copy, not a move.
 *
 * WHY get() NEEDED NEW CODE
 * -------------------------
 * There was no server-side read path for UploadThing anywhere in the codebase
 * — the old module could mint refs and delete, nothing more. The temptation is
 * to build "https://{appId}.ufs.sh/f/{key}" by hand, which is URL-guessing of
 * exactly the kind that produced the original P0 bug, and it silently fails
 * for private files.
 *
 * Instead get() asks the SDK for a presigned URL (generateSignedURL) and
 * fetches that. It works for public and private files alike, and the SDK
 * generates it locally without a round trip to UploadThing's API.
 */

import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import { env } from "~/env";
import {
  parseUploadThingIdentityFromToken,
  storageLocationIdForUploadThing,
} from "~/lib/storage-location-id";

const ADAPTER = "uploadthing" as const;

function getUploadThingToken(): string {
  const token = env.server.UPLOADTHING_TOKEN ?? process.env.UPLOADTHING_TOKEN;
  if (!token) throw new Error("UPLOADTHING_TOKEN is not configured.");
  return token;
}

/** The location a ref minted under the *current* token would carry. */
function currentStorageLocationId(): string {
  const identity = parseUploadThingIdentityFromToken(getUploadThingToken());
  if (!identity) throw new Error("UPLOADTHING_TOKEN is unparseable.");
  return storageLocationIdForUploadThing(identity.appId, identity.region);
}

async function getUTApi() {
  const { UTApi } = await import("uploadthing/server");
  return new UTApi({ token: getUploadThingToken() });
}

/**
 * Same classifier the previous module used: an auth/config problem is
 * permanent and needs a human (BLOCKED), anything else is worth retrying.
 */
function isAuthOrConfigError(text: string): boolean {
  return /Unauthorized|Forbidden|AccessDenied|InvalidToken|Credentials|Credential|permission|not configured|unparseable|misconfigured/i.test(
    text,
  );
}

function assertOwnAdapter(ref: ObjectRef): void {
  if (ref.adapter !== ADAPTER) {
    throw new Error(
      `[uploadthing-adapter] received a ref for adapter "${ref.adapter}". ` +
        "Use getStoragePort().forAdapter(ref.adapter) to reach the right one.",
    );
  }
}

/**
 * Decision 4: a ref names the app (and region) it was minted against. If the
 * configured token now points somewhere else, the key would address a
 * different file that happens to share an id. Refuse rather than guess.
 */
function locationMismatch(ref: ObjectRef): string | null {
  let current: string;
  try {
    current = currentStorageLocationId();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return ref.storageLocationId === current
    ? null
    : `Ref location ${ref.storageLocationId} does not match the configured UploadThing app (${current}).`;
}

export function createUploadThingAdapter(): TargetedStoragePort {
  const deleteImpl = async (ref: ObjectRef): Promise<DeleteResult> => {
    assertOwnAdapter(ref);

    const mismatch = locationMismatch(ref);
    if (mismatch) {
      return {
        ref,
        outcome: "blocked",
        errorCode: "storage_location_mismatch",
        message: mismatch,
      };
    }

    try {
      const utapi = await getUTApi();
      const response = await utapi.deleteFiles(ref.key);

      if (!response.success) {
        return {
          ref,
          outcome: "retryable",
          errorCode: "uploadthing_delete_failed",
          message: "UploadThing delete returned success=false.",
        };
      }

      // Unlike Vercel Blob, UploadThing tells us how many files it actually
      // removed — so "it was already gone" is observable here and reported
      // honestly rather than collapsed into "deleted".
      return response.deletedCount === 0
        ? { ref, outcome: "not_found" }
        : { ref, outcome: "deleted" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof Error && err.name ? err.name : "uploadthing_delete_failed";

      return {
        ref,
        outcome: isAuthOrConfigError(`${code} ${message}`) ? "blocked" : "retryable",
        errorCode: code,
        message,
      };
    }
  };

  const signedUrlImpl = async (
    ref: ObjectRef,
    opts?: GetSignedUrlOptions,
  ): Promise<string> => {
    assertOwnAdapter(ref);

    const mismatch = locationMismatch(ref);
    if (mismatch) throw new Error(`[uploadthing-adapter] ${mismatch}`);

    const utapi = await getUTApi();
    const { ufsUrl } = await utapi.generateSignedURL(
      ref.key,
      opts?.expiresIn !== undefined ? { expiresIn: opts.expiresIn } : undefined,
    );
    return ufsUrl;
  };

  return {
    adapter: ADAPTER,
    provider: ADAPTER,

    async put(_input: UploadInput): Promise<UploadResult> {
      // Deliberately unsupported, and loudly so. UploadThing uploads happen in
      // the browser through its client SDK; there is no server-side write path
      // in this app, and C2 scopes the browser flow out.
      //
      // The dangerous alternative would be quietly forwarding to the default
      // backend — a caller asking for UploadThing would get their bytes in S3
      // or Postgres, compile clean, pass tests, and only surface when someone
      // went looking for a file that was never there. That is precisely the
      // silent-misrouting failure forAdapter() exists to prevent.
      throw new Error(
        "[uploadthing-adapter] put() is not supported: UploadThing uploads are " +
          "client-side. Use the UploadThing SDK route (api/uploadthing), or target " +
          "a different adapter explicitly if these bytes should live elsewhere.",
      );
    },

    async get(ref: ObjectRef, init?: RequestInit): Promise<Response> {
      assertOwnAdapter(ref);

      const mismatch = locationMismatch(ref);
      if (mismatch) throw new Error(`[uploadthing-adapter] ${mismatch}`);

      // A presigned URL works for both public and private files, so there is
      // no access mode to detect the way there is for Vercel Blob.
      const url = await signedUrlImpl(ref);

      // Returned as-is, fetch-style: callers check response.ok, exactly as
      // they do today with fetchFile. A missing file surfaces as a non-ok
      // response rather than a thrown error.
      return fetch(url, init);
    },

    delete: deleteImpl,

    async deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      if (refs.length === 0) return [];
      for (const ref of refs) assertOwnAdapter(ref);

      const results: DeleteResult[] = [];
      const deletable: ObjectRef[] = [];

      for (const ref of refs) {
        const mismatch = locationMismatch(ref);
        if (mismatch) {
          results.push({
            ref,
            outcome: "blocked",
            errorCode: "storage_location_mismatch",
            message: mismatch,
          });
        } else {
          deletable.push(ref);
        }
      }

      if (deletable.length === 0) return results;

      try {
        const utapi = await getUTApi();
        const response = await utapi.deleteFiles(deletable.map((ref) => ref.key));

        // The bulk call reports a count, not which keys it removed. A full
        // count is unambiguous; anything less means some were already gone —
        // but we cannot tell which, and guessing would attribute a not_found
        // to the wrong ref. Fall back to per-key deletes so every outcome is
        // one we actually observed (design doc A7: no all-or-nothing lie).
        if (response.success && response.deletedCount === deletable.length) {
          for (const ref of deletable) results.push({ ref, outcome: "deleted" });
          return results;
        }
      } catch {
        // Fall through to the per-ref path, which classifies properly.
      }

      for (const ref of deletable) {
        results.push(await deleteImpl(ref));
      }
      return results;
    },

    getSignedUrl: signedUrlImpl,
  };
}
