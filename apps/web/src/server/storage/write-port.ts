import type { ObjectRef } from "@launchstack/core/storage";

import { getS3StorageAdapter } from "~/server/storage/adapters/s3-adapter";

export interface StorageWritePort {
  put(input: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<{
    ref: ObjectRef;
    url: string;
    pathname: string;
    provider: "s3";
  }>;
  mintRef(key: string): ObjectRef;
  getSignedUrl(input: {
    ref: ObjectRef;
    operation: "put" | "get";
    contentType?: string;
    expiresIn?: number;
  }): Promise<string>;
  getBucketName(): string;
}

export function createStorageWritePort(): StorageWritePort {
  const s3 = getS3StorageAdapter();

  return {
    put(input) {
      return s3.put(input);
    },

    mintRef(key: string): ObjectRef {
      return s3.mintRef(key);
    },

    getSignedUrl(input) {
      return s3.getSignedUrl(input);
    },

    getBucketName(): string {
      return s3.getBucketName();
    },
  };
}
