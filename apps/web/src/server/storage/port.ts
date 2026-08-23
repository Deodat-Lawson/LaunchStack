/**
 * Concrete StoragePort implementation that routes canonical operations through
 * the targeted adapter factory. This is what apps/web hands to
 * createEngine so core can read and write objects without knowing
 * about S3, Vercel Blob, or the database-base64 fallback.
 *
 * The legacy string overload still delegates to fetchFile in ~/lib/storage;
 * canonical ObjectRef operations never bypass their targeted adapter.
 */

import type {
  DeleteResult,
  ObjectRef,
  StorageAdapter,
  StoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import { fetchFile, resolveStorageBackend } from "~/lib/storage";
import { createStoragePortTargetFactory } from "./create-storage-port";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";

export function createAppStoragePort(): StoragePort {
  const provider = resolveStorageBackend();
  const targets = createStoragePortTargetFactory(provider);

  const putImpl = async (input: UploadInput): Promise<UploadResult> => {
    return targets.forAdapter(provider).put(input);
  };

  const getImpl = (input: ObjectRef | string, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string") {
      return fetchFile(input, init);
    }

    return targets.forAdapter(input.adapter).get(input, init);
  };

  const deleteRefImpl = (ref: ObjectRef): Promise<DeleteResult> => {
    return targets.forAdapter(ref.adapter).delete(ref);
  };

  const deleteManyImpl = async (refs: readonly ObjectRef[]): Promise<DeleteResult[]> => {
    if (refs.length === 0) return [];

    const groups = new Map<
      string,
      { adapter: StorageAdapter; refs: ObjectRef[]; indexes: number[] }
    >();

    refs.forEach((ref, index) => {
      const groupKey = `${ref.adapter}::${ref.storageLocationId}`;
      const group = groups.get(groupKey);
      if (group) {
        group.refs.push(ref);
        group.indexes.push(index);
      } else {
        groups.set(groupKey, {
          adapter: ref.adapter,
          refs: [ref],
          indexes: [index],
        });
      }
    });

    const results: Array<DeleteResult | undefined> = new Array(refs.length);
    for (const group of groups.values()) {
      const groupResults = await targets.forAdapter(group.adapter).deleteMany(group.refs);

      groupResults.forEach((result, index) => {
        const originalIndex = group.indexes[index];
        if (originalIndex !== undefined) {
          results[originalIndex] = result;
        }
      });
    }

    return results as DeleteResult[];
  };

  async function deleteImpl(ref: ObjectRef): Promise<DeleteResult>;
  async function deleteImpl(urlOrKey: string): Promise<void>;
  async function deleteImpl(input: ObjectRef | string): Promise<DeleteResult | void> {
    if (typeof input === "string") {
      if (!input) return;
      const promoted = promoteLegacyUrlToRef({ value: input });
      if (!promoted.ok) {
        throw new Error(`Ref promotion failed (${promoted.reason})`);
      }

      const result = await deleteRefImpl(promoted.ref);
      if (
        result.outcome === "retryable" ||
        result.outcome === "blocked" ||
        result.outcome === "rejected"
      ) {
        throw new Error(result.message ?? `Delete failed with outcome=${result.outcome}`);
      }
      return;
    }

    return deleteRefImpl(input);
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
      return deleteRefImpl(ref);
    },

    /** @deprecated Use deleteMany(). */
    deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      return deleteManyImpl(refs);
    },
  };
}
