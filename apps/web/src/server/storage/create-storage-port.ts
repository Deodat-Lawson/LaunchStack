import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  StorageAdapter,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import { createDatabaseAdapter } from "./adapters/database-adapter";
import { createS3TargetedPort } from "./adapters/s3-targeted-port";
import { createUploadThingAdapter } from "./adapters/uploadthing-adapter";
import { createVercelBlobAdapter } from "./adapters/vercel-blob-adapter";

function createUnwiredAdapterTarget(
  adapter: StorageAdapter,
  provider: string,
): TargetedStoragePort {
  const error = (method: string): Error =>
    new Error(
      `[storage] Adapter target "${adapter}" is not wired for ${method} yet. ` +
        "A2 only locks the contract surface; concrete adapter extraction lands later.",
    );

  return {
    adapter,
    provider,
    async put(_input: UploadInput): Promise<UploadResult> {
      throw error("put()");
    },
    async get(_ref: ObjectRef, _init?: RequestInit): Promise<Response> {
      throw error("get()");
    },
    async delete(_ref: ObjectRef): Promise<DeleteResult> {
      throw error("delete()");
    },
    async deleteMany(_refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      throw error("deleteMany()");
    },
    async getSignedUrl(_ref: ObjectRef, _opts?: GetSignedUrlOptions): Promise<string> {
      throw error("getSignedUrl()");
    },
  };
}

/**
 * Target factory for canonical storage operations. The app port and legacy
 * compatibility shims resolve each adapter through this surface so backend
 * selection cannot silently route a request to the primary provider.
 */
export function createStoragePortTargetFactory(provider: string): {
  forAdapter(adapter: StorageAdapter): TargetedStoragePort;
} {
  return {
    forAdapter(adapter: StorageAdapter): TargetedStoragePort {
      switch (adapter) {
        case "s3":
          return createS3TargetedPort();
        case "vercel-blob":
          return createVercelBlobAdapter();
        case "uploadthing":
          return createUploadThingAdapter();
        case "database":
          return createDatabaseAdapter();
        default:
          // Unreachable while StorageAdapter has exactly these four members.
          // Kept so that adding a fifth adapter fails loudly at runtime
          // instead of silently resolving to whichever backend is primary.
          return createUnwiredAdapterTarget(adapter, provider);
      }
    },
  };
}
