/**
 * Concrete StoragePort implementation that wraps the app's existing
 * storage helpers (~/lib/storage). This is what apps/web hands to
 * createEngine so core can read and write objects without knowing
 * about S3, Vercel Blob, or the database-base64 fallback.
 *
 * The underlying storage helpers already auto-detect the active backend
 * from env; the port just adapts their shape to the StoragePort
 * interface exported by @launchstack/core.
 */

import type {
  DeleteResult,
  ObjectRef,
  StoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import {
  deleteFileByRef,
  deleteManyByRef,
  uploadFile,
  fetchFile,
<<<<<<< HEAD
=======
  deleteFileByRef,
  deleteManyByRef,
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
  resolveStorageBackend,
} from "~/lib/storage";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";

export function createAppStoragePort(): StoragePort {
  const provider = resolveStorageBackend();

  return {
    provider,

    async upload(input: UploadInput): Promise<UploadResult> {
      // The app's uploadFile requires a userId; default to "system" for
      // engine-initiated writes that do not carry an end-user context.
      const result = await uploadFile({
        filename: input.filename,
        data: input.data,
        contentType: input.contentType,
        userId: input.userId ?? "system",
      });
      return {
        url: result.url,
        pathname: result.pathname,
        ref: result.ref,
        contentType: result.contentType,
        provider: result.provider,
      };
    },

    deleteRef(ref: ObjectRef): Promise<DeleteResult> {
      return deleteFileByRef(ref);
    },

    deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      return deleteManyByRef(refs);
    },

    download(urlOrKey, init) {
      return fetchFile(urlOrKey, init);
    },

<<<<<<< HEAD
    /** @deprecated Use deleteRef/deleteMany. Kept as URL-based migration shim. */
    async delete(urlOrKey) {
      if (!urlOrKey) return;

      const promoted = promoteLegacyUrlToRef({ value: urlOrKey });
      if (!promoted.ok) {
        throw new Error(`Ref promotion failed (${promoted.reason})`);
      }

      const result = await deleteFileByRef(promoted.ref);
      if (result.outcome === "retryable" || result.outcome === "blocked" || result.outcome === "rejected") {
        throw new Error(result.message ?? `Delete failed with outcome=${result.outcome}`);
      }
=======
    deleteRef(ref) {
      return deleteFileByRef(ref);
    },

    deleteMany(refs) {
      return deleteManyByRef(refs);
    },

    async delete(urlOrKey) {
      const promoted = promoteLegacyUrlToRef({ value: urlOrKey });
      if (!promoted.ok) {
        throw new Error(
          `StoragePort.delete could not promote the legacy reference: ${promoted.reason}`,
        );
      }
      const result = await deleteFileByRef(promoted.ref);
      if (result.outcome === "deleted" || result.outcome === "not_found") {
        return;
      }
      throw new Error(result.message ?? result.errorCode ?? "Storage delete failed");
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
    },
  };
}
