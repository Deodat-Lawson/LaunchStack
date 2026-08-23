import { randomUUID } from "node:crypto";

import type {
  DeleteResult,
  GetSignedUrlOptions,
  ObjectRef,
  TargetedStoragePort,
  UploadInput,
  UploadResult,
} from "@launchstack/core/storage";

import { resolveStorageLocationId } from "~/lib/storage-location-id";
import { getS3StorageAdapter, type DeleteObjectOutcome } from "./s3-adapter";

const ADAPTER = "s3" as const;

function sanitizeFilename(filename: string): string {
  return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function toBuffer(data: UploadInput["data"]): Buffer {
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function assertOwnAdapter(ref: ObjectRef): void {
  if (ref.adapter !== ADAPTER) {
    throw new Error(
      `[s3-targeted-port] received a ref for adapter "${ref.adapter}". ` +
        "Use getStoragePort().forAdapter(ref.adapter) to reach the right one.",
    );
  }
}

function getLocationMismatch(ref: ObjectRef): string | null {
  const expectedLocationId = resolveStorageLocationId(ADAPTER);
  return ref.storageLocationId === expectedLocationId
    ? null
    : `Ref storageLocationId (${ref.storageLocationId}) does not match active S3 location (${expectedLocationId}).`;
}

function assertReadableRef(ref: ObjectRef): void {
  assertOwnAdapter(ref);
  const mismatch = getLocationMismatch(ref);
  if (mismatch) throw new Error(`[s3-targeted-port] ${mismatch}`);
}

function errorDetails(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
        ? error.code
        : "s3_delete_failed";

  return { code, message };
}

function isBlockedError(code: string, message: string): boolean {
  return /AccessDenied|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|ExpiredToken|Credentials|Credential|permission|AuthFailed/i.test(
    `${code} ${message}`,
  );
}

function mapDeleteError(ref: ObjectRef, error: unknown): DeleteResult {
  const { code, message } = errorDetails(error);
  return {
    ref,
    outcome: isBlockedError(code, message) ? "blocked" : "retryable",
    errorCode: code,
    message,
  };
}

function mapBatchOutcome(ref: ObjectRef, outcome: DeleteObjectOutcome | undefined): DeleteResult {
  if (!outcome) {
    return {
      ref,
      outcome: "retryable",
      errorCode: "missing_delete_outcome",
      message: `No delete outcome returned for key "${ref.key}".`,
    };
  }

  return {
    ref,
    outcome: outcome.outcome,
    errorCode: outcome.errorCode,
    message: outcome.message,
  };
}

export function createS3TargetedPort(): TargetedStoragePort {
  const s3 = getS3StorageAdapter();

  return {
    adapter: ADAPTER,
    provider: ADAPTER,

    async put(input: UploadInput): Promise<UploadResult> {
      const safeName = sanitizeFilename(input.filename);
      const key = `documents/${randomUUID()}-${safeName || "upload"}`;
      const result = await s3.put({
        key,
        body: toBuffer(input.data),
        contentType: input.contentType,
      });

      return {
        ...result,
        contentType: input.contentType,
      };
    },

    async get(ref: ObjectRef, init?: RequestInit): Promise<Response> {
      assertReadableRef(ref);
      return fetch(s3.getObjectUrl(ref.key), init);
    },

    async delete(ref: ObjectRef): Promise<DeleteResult> {
      assertOwnAdapter(ref);
      const mismatch = getLocationMismatch(ref);
      if (mismatch) {
        return {
          ref,
          outcome: "blocked",
          errorCode: "storage_location_mismatch",
          message: mismatch,
        };
      }

      try {
        await s3.deleteObject(ref.key);
        return { ref, outcome: "deleted" };
      } catch (error) {
        return mapDeleteError(ref, error);
      }
    },

    async deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
      if (refs.length === 0) return [];

      const results: Array<DeleteResult | undefined> = new Array(refs.length);
      const deletable: Array<{ index: number; ref: ObjectRef }> = [];

      refs.forEach((ref, index) => {
        assertOwnAdapter(ref);
        const mismatch = getLocationMismatch(ref);
        if (mismatch) {
          results[index] = {
            ref,
            outcome: "blocked",
            errorCode: "storage_location_mismatch",
            message: mismatch,
          };
        } else {
          deletable.push({ index, ref });
        }
      });

      if (deletable.length > 0) {
        try {
          const outcomes = await s3.deleteObjects(deletable.map(({ ref }) => ref.key));
          const outcomeByKey = new Map(outcomes.map((outcome) => [outcome.key, outcome]));

          for (const { index, ref } of deletable) {
            results[index] = mapBatchOutcome(ref, outcomeByKey.get(ref.key));
          }
        } catch (error) {
          for (const { index, ref } of deletable) {
            results[index] = mapDeleteError(ref, error);
          }
        }
      }

      return results as DeleteResult[];
    },

    async getSignedUrl(ref: ObjectRef, opts?: GetSignedUrlOptions): Promise<string> {
      assertReadableRef(ref);
      return s3.getSignedUrl({
        ref,
        operation: "get",
        ...(opts?.expiresIn !== undefined ? { expiresIn: opts.expiresIn } : {}),
      });
    },
  };
}
