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
  resolveStorageBackend,
} from "~/lib/storage";
import { createStoragePortTargetFactory } from "./create-storage-port";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";

export function createAppStoragePort(): StoragePort {
  const provider = resolveStorageBackend();
  const targets = createStoragePortTargetFactory(provider);

  const putImpl = async (input: UploadInput): Promise<UploadResult> => {
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
  };

  const getImpl = (input: ObjectRef | string, init?: RequestInit): Promise<Response> => {
    const urlOrKey = typeof input === "string" ? input : input.key;
    return fetchFile(urlOrKey, init);
  };

  async function deleteImpl(ref: ObjectRef): Promise<DeleteResult>;
  async function deleteImpl(urlOrKey: string): Promise<void>;
  async function deleteImpl(input: ObjectRef | string): Promise<DeleteResult | void> {
    if (typeof input !== "string") {
      return deleteFileByRef(input);
    }

    if (!input) return;
    const promoted = promoteLegacyUrlToRef({ value: input });
    if (!promoted.ok) {
      throw new Error(`Ref promotion failed (${promoted.reason})`);
    }

    const result = await deleteFileByRef(promoted.ref);
    if (result.outcome === "retryable" || result.outcome === "blocked" || result.outcome === "rejected") {
      throw new Error(result.message ?? `Delete failed with outcome=${result.outcome}`);
    }
  }

  return {
    provider,

    put(input: UploadInput): Promise<UploadResult> {
      return putImpl(input);
    },

    get(input: ObjectRef | string, init?: RequestInit): Promise<Response> {
      return getImpl(input, init);
    },

    /**
     * Canonical delete accepts ObjectRef; the legacy string overload remains
     * available for migration and promotes through legacy-promote.
     */
    delete: deleteImpl,

    getSignedUrl(ref, opts) {
      return targets.forAdapter(ref.adapter).getSignedUrl(ref, opts);
    },

    forAdapter(adapter) {
      return targets.forAdapter(adapter);
    },

    /** @deprecated Use put(). */
    async upload(input: UploadInput): Promise<UploadResult> {
      return putImpl(input);
    },

    /** @deprecated Use get(). */
    download(urlOrKey, init) {
      return getImpl(urlOrKey, init);
    },

    /** @deprecated Use delete(ObjectRef). */
    deleteRef(ref: ObjectRef): Promise<DeleteResult> {
      return deleteFileByRef(ref);
    },

    /** @deprecated Use deleteMany(). */
    deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      return deleteManyByRef(refs);
    },
  };
}
