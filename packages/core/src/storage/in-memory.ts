import { randomUUID } from "node:crypto";

import type { DeleteResult, ObjectRef, StoragePort, UploadInput, UploadResult } from "./types";

export interface InMemoryStoredObject {
  ref: ObjectRef;
  data: Buffer;
  contentType?: string;
  url: string;
  pathname: string;
}

export interface InMemoryStoragePort extends StoragePort {
  seedObject(input: {
    ref: ObjectRef;
    data: Buffer | ArrayBuffer | Uint8Array;
    contentType?: string;
    url?: string;
    pathname?: string;
  }): InMemoryStoredObject;
  getObject(ref: ObjectRef): InMemoryStoredObject | undefined;
  listObjects(): InMemoryStoredObject[];
}

export interface CreateInMemoryStoragePortOptions {
  provider?: string;
  adapter?: ObjectRef["adapter"];
  storageLocationId?: string;
  urlBase?: string;
}

function makeRefKey(ref: ObjectRef): string {
  return `${ref.adapter}::${ref.storageLocationId}::${ref.key}`;
}

function toBuffer(data: Buffer | ArrayBuffer | Uint8Array): Buffer {
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function toUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;
}

/**
 * Test-only in-memory StoragePort implementation.
 *
 * Useful for worker/unit tests that need deterministic upload/download/delete
 * behavior without touching external adapters.
 */
export function createInMemoryStoragePort(
  options: CreateInMemoryStoragePortOptions = {},
): InMemoryStoragePort {
  const adapter = options.adapter ?? "database";
  const storageLocationId = options.storageLocationId ?? "memory:default";
  const provider = options.provider ?? `memory:${adapter}`;
  const urlBase = options.urlBase ?? "memory://storage";

  const objects = new Map<string, InMemoryStoredObject>();
  const urlToRefKey = new Map<string, string>();

  const seedObject: InMemoryStoragePort["seedObject"] = (input) => {
    const pathname = input.pathname ?? input.ref.key;
    const url = input.url ?? toUrl(urlBase, pathname);
    const stored: InMemoryStoredObject = {
      ref: input.ref,
      data: toBuffer(input.data),
      contentType: input.contentType,
      url,
      pathname,
    };

    const refKey = makeRefKey(input.ref);
    objects.set(refKey, stored);
    urlToRefKey.set(url, refKey);
    return stored;
  };

  const deleteRefImpl = async (ref: ObjectRef): Promise<DeleteResult> => {
    const refKey = makeRefKey(ref);
    if (!objects.has(refKey)) {
      return { ref, outcome: "not_found" };
    }

    objects.delete(refKey);
    for (const [url, key] of urlToRefKey.entries()) {
      if (key === refKey) {
        urlToRefKey.delete(url);
      }
    }

    return { ref, outcome: "deleted" };
  };

  const deleteManyImpl = async (refs: readonly ObjectRef[]): Promise<DeleteResult[]> => {
    const results: DeleteResult[] = [];
    for (const ref of refs) {
      results.push(await deleteRefImpl(ref));
    }
    return results;
  };

  return {
    provider,

    async upload(input: UploadInput): Promise<UploadResult> {
      const pathname = `documents/${randomUUID()}-${input.filename.replace(/\s+/g, "-")}`;
      const ref: ObjectRef = {
        adapter,
        storageLocationId,
        key: pathname,
      };
      const stored = seedObject({
        ref,
        data: input.data,
        contentType: input.contentType,
        pathname,
      });

      return {
        url: stored.url,
        pathname: stored.pathname,
        ref,
        contentType: stored.contentType,
        provider,
      };
    },

    async download(urlOrKey: string): Promise<Response> {
      const refKeyByUrl = urlToRefKey.get(urlOrKey);
      let stored: InMemoryStoredObject | undefined;

      if (refKeyByUrl) {
        stored = objects.get(refKeyByUrl);
      } else {
        const syntheticRef: ObjectRef = {
          adapter,
          storageLocationId,
          key: urlOrKey,
        };
        stored = objects.get(makeRefKey(syntheticRef));
      }

      if (!stored) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(new Uint8Array(stored.data), {
        status: 200,
        headers: stored.contentType ? { "content-type": stored.contentType } : undefined,
      });
    },

    deleteRef: deleteRefImpl,

    deleteMany: deleteManyImpl,

    async delete(urlOrKey: string): Promise<void> {
      const refKeyByUrl = urlToRefKey.get(urlOrKey);
      if (refKeyByUrl) {
        const stored = objects.get(refKeyByUrl);
        if (!stored) return;
        await deleteRefImpl(stored.ref);
        return;
      }

      const ref: ObjectRef = {
        adapter,
        storageLocationId,
        key: urlOrKey,
      };
      await deleteRefImpl(ref);
    },

    seedObject,

    getObject(ref: ObjectRef): InMemoryStoredObject | undefined {
      return objects.get(makeRefKey(ref));
    },

    listObjects(): InMemoryStoredObject[] {
      return [...objects.values()];
    },
  };
}
