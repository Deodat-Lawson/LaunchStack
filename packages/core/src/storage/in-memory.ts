import { randomUUID } from "node:crypto";

import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  StorageAdapter,
  StoragePort,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "./types";

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

type InMemoryGetInput = ObjectRef | string;

function makeRefKey(ref: ObjectRef): string {
  return `${ref.adapter}::${ref.storageLocationId}::${ref.key}`;
}

function toBuffer(data: Buffer | ArrayBuffer | Uint8Array): Buffer {
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function toUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;
}

function coerceKey(input: string): string {
  return input.replace(/\s+/g, "-");
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
  const defaultAdapter = options.adapter ?? "database";
  const defaultStorageLocationId = options.storageLocationId ?? `memory:${defaultAdapter}`;
  const provider = options.provider ?? `memory:${defaultAdapter}`;
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

  const resolveStorageLocationId = (targetAdapter: StorageAdapter): string => {
    if (targetAdapter === defaultAdapter) {
      return defaultStorageLocationId;
    }
    return `memory:${targetAdapter}`;
  };

  const resolveStoredObject = (input: InMemoryGetInput): InMemoryStoredObject | undefined => {
    if (typeof input !== "string") {
      return objects.get(makeRefKey(input));
    }

    const refKeyByUrl = urlToRefKey.get(input);
    if (refKeyByUrl) {
      return objects.get(refKeyByUrl);
    }

    const syntheticRef: ObjectRef = {
      adapter: defaultAdapter,
      storageLocationId: resolveStorageLocationId(defaultAdapter),
      key: input,
    };
    return objects.get(makeRefKey(syntheticRef));
  };

  const getImpl = async (input: InMemoryGetInput): Promise<Response> => {
    const stored = resolveStoredObject(input);
    if (!stored) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(new Uint8Array(stored.data), {
      status: 200,
      headers: stored.contentType ? { "content-type": stored.contentType } : undefined,
    });
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

  const deleteLegacyImpl = async (urlOrKey: string): Promise<void> => {
    const stored = resolveStoredObject(urlOrKey);
    if (!stored) {
      return;
    }
    await deleteRefImpl(stored.ref);
  };

  const getSignedUrlImpl = async (
    ref: ObjectRef,
    opts?: GetSignedUrlOptions,
  ): Promise<string> => {
    const stored = resolveStoredObject(ref);
    const url = stored?.url ?? toUrl(urlBase, ref.key);
    const expiresIn = opts?.expiresIn;
    return expiresIn ? `${url}?expiresIn=${expiresIn}` : url;
  };

  const putForAdapter = async (
    targetAdapter: StorageAdapter,
    input: UploadInput,
  ): Promise<UploadResult> => {
    const pathname = `documents/${randomUUID()}-${coerceKey(input.filename)}`;
    const ref: ObjectRef = {
      adapter: targetAdapter,
      storageLocationId: resolveStorageLocationId(targetAdapter),
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
  };

  const createTargetedPort = (targetAdapter: StorageAdapter): TargetedStoragePort => ({
    adapter: targetAdapter,
    provider,
    put(input: UploadInput): Promise<UploadResult> {
      return putForAdapter(targetAdapter, input);
    },
    get(ref: ObjectRef, init?: RequestInit): Promise<Response> {
      void init;
      return getImpl(ref);
    },
    delete(ref: ObjectRef): Promise<DeleteResult> {
      return deleteRefImpl(ref);
    },
    deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      return deleteManyImpl(refs);
    },
    getSignedUrl(ref: ObjectRef, opts?: GetSignedUrlOptions): Promise<string> {
      return getSignedUrlImpl(ref, opts);
    },
  });

  async function deleteImpl(ref: ObjectRef): Promise<DeleteResult>;
  async function deleteImpl(urlOrKey: string): Promise<void>;
  async function deleteImpl(input: ObjectRef | string): Promise<DeleteResult | void> {
    if (typeof input === "string") {
      await deleteLegacyImpl(input);
      return;
    }

    return deleteRefImpl(input);
  }

  return {
    provider,

    put(input: UploadInput): Promise<UploadResult> {
      return putForAdapter(defaultAdapter, input);
    },

    get(input: InMemoryGetInput, init?: RequestInit): Promise<Response> {
      void init;
      return getImpl(input);
    },

    delete: deleteImpl,

    getSignedUrl(ref: ObjectRef, opts?: GetSignedUrlOptions): Promise<string> {
      return getSignedUrlImpl(ref, opts);
    },

    forAdapter(targetAdapter: StorageAdapter): TargetedStoragePort {
      return createTargetedPort(targetAdapter);
    },

    async upload(input: UploadInput): Promise<UploadResult> {
      return putForAdapter(defaultAdapter, input);
    },

    async download(urlOrKey: string, init?: RequestInit): Promise<Response> {
      void init;
      return getImpl(urlOrKey);
    },

    deleteRef: deleteRefImpl,

    deleteMany: deleteManyImpl,

    seedObject,

    getObject(ref: ObjectRef): InMemoryStoredObject | undefined {
      return objects.get(makeRefKey(ref));
    },

    listObjects(): InMemoryStoredObject[] {
      return [...objects.values()];
    },
  };
}
