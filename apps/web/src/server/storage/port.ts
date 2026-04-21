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

import type { StoragePort, UploadInput, UploadResult } from "@launchstack/core/storage";

import {
  uploadFile,
  fetchFile,
  deleteFileByUrl,
  resolveStorageBackend,
} from "~/lib/storage";

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
        contentType: result.contentType,
        provider: result.provider,
      };
    },

    download(urlOrKey, init) {
      return fetchFile(urlOrKey, init);
    },

    delete(urlOrKey) {
      return deleteFileByUrl(urlOrKey);
    },
  };
}
