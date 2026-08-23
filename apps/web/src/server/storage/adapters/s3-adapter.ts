import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectRef } from "@launchstack/core/storage";

import { env } from "~/env";
import { resolveStorageLocationId } from "~/lib/storage-location-id";

export interface DeleteObjectOutcome {
  key: string;
  outcome: "deleted" | "not_found" | "retryable" | "blocked";
  errorCode?: string;
  message?: string;
}

export interface PutResult {
  ref: ObjectRef;
  url: string;
  pathname: string;
  provider: "s3";
}

export interface SignedUrlInput {
  ref: ObjectRef;
  operation: "put" | "get";
  contentType?: string;
  expiresIn?: number;
}

export interface S3ListedObject {
  key: string;
  size?: number;
  lastModified?: string;
  etag?: string;
}

export interface S3PrivilegedListInput {
  prefix?: string;
  cursor?: string;
  limit: number;
}

export interface S3PrivilegedListResult {
  objects: S3ListedObject[];
  nextCursor?: string;
}

interface ResolvedS3Config {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  ensureBucketExists: boolean;
}

function readStringEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return undefined;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function resolveS3Config(): ResolvedS3Config {
  const endpoint =
    readStringEnv("STORAGE_S3_ENDPOINT", "NEXT_PUBLIC_S3_ENDPOINT") ??
    env.server.NEXT_PUBLIC_S3_ENDPOINT ??
    env.client.NEXT_PUBLIC_S3_ENDPOINT;

  const publicEndpoint =
    readStringEnv("STORAGE_S3_PUBLIC_ENDPOINT", "S3_PUBLIC_ENDPOINT") ??
    env.server.S3_PUBLIC_ENDPOINT ??
    endpoint;

  const region = readStringEnv("STORAGE_S3_REGION", "S3_REGION") ?? env.server.S3_REGION ?? "us-east-1";

  const accessKeyId =
    readStringEnv("STORAGE_S3_ACCESS_KEY", "STORAGE_S3_ACCESS_KEY_ID", "S3_ACCESS_KEY") ??
    env.server.S3_ACCESS_KEY;

  const secretAccessKey =
    readStringEnv("STORAGE_S3_SECRET_KEY", "STORAGE_S3_SECRET_ACCESS_KEY", "S3_SECRET_KEY") ??
    env.server.S3_SECRET_KEY;

  const bucket =
    readStringEnv("STORAGE_S3_BUCKET_NAME", "STORAGE_S3_BUCKET", "S3_BUCKET_NAME") ??
    env.server.S3_BUCKET_NAME;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 configuration is incomplete. Configure STORAGE_S3_ENDPOINT/STORAGE_S3_BUCKET_NAME/STORAGE_S3_ACCESS_KEY/STORAGE_S3_SECRET_KEY (or legacy NEXT_PUBLIC_S3_ENDPOINT/S3_BUCKET_NAME/S3_ACCESS_KEY/S3_SECRET_KEY).",
    );
  }

  return {
    endpoint: normalizeEndpoint(endpoint),
    publicEndpoint: normalizeEndpoint(publicEndpoint ?? endpoint),
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    // Preserve today's behavior unless explicitly overridden.
    forcePathStyle: readBooleanEnv("STORAGE_S3_FORCE_PATH_STYLE") ?? true,
    // Bucket creation is now opt-in because many managed S3 providers forbid it.
    ensureBucketExists: readBooleanEnv("STORAGE_S3_ENSURE_BUCKET_EXISTS") ?? false,
  };
}

function isS3BlockedDeleteError(code: string, message?: string): boolean {
  const haystack = `${code} ${message ?? ""}`;
  return /AccessDenied|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|ExpiredToken|Credentials|Credential|permission|AuthFailed/i.test(
    haystack,
  );
}

export class S3StorageAdapter {
  private client: S3Client | null = null;
  private bucketEnsured = false;
  private warnedVirtualHostedUrlLimitation = false;

  private config(): ResolvedS3Config {
    return resolveS3Config();
  }

  getClient(): S3Client {
    if (!this.client) {
      const config = this.config();
      this.client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: config.forcePathStyle,
      });
    }

    return this.client;
  }

  getBucketName(): string {
    return this.config().bucket;
  }

  getEndpoint(): string {
    return this.config().endpoint;
  }

  mintRef(key: string): ObjectRef {
    return {
      adapter: "s3",
      storageLocationId: resolveStorageLocationId("s3"),
      key,
    };
  }

  private assertActiveRef(ref: ObjectRef): void {
    if (ref.adapter !== "s3") {
      throw new Error(`S3 adapter cannot handle ref adapter=${ref.adapter}`);
    }

    const expectedLocationId = resolveStorageLocationId("s3");
    if (ref.storageLocationId !== expectedLocationId) {
      throw new Error(
        `Ref storageLocationId (${ref.storageLocationId}) does not match active S3 location (${expectedLocationId}).`,
      );
    }
  }

  async ensureBucketExists(): Promise<void> {
    const config = this.config();
    if (!config.ensureBucketExists || this.bucketEnsured) {
      return;
    }

    const client = this.getClient();
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
        console.log(`[S3] Created bucket "${config.bucket}" at ${config.endpoint}`);
      } catch (createErr) {
        throw new Error(
          `Failed to create S3 bucket "${config.bucket}" at ${config.endpoint}: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
        );
      }
    }

    this.bucketEnsured = true;
  }

  async putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
    const client = this.getClient();
    const config = this.config();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      throw new Error(
        `Failed to upload object "${key}" to S3 at ${config.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listObjectsPrivileged(input: S3PrivilegedListInput): Promise<S3PrivilegedListResult> {
    const client = this.getClient();
    const config = this.config();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: input.prefix,
        ContinuationToken: input.cursor,
        MaxKeys: input.limit,
      }),
    );

    const objects: S3ListedObject[] = [];
    for (const entry of response.Contents ?? []) {
      if (!entry.Key) continue;
      objects.push({
        key: entry.Key,
        size: typeof entry.Size === "number" ? entry.Size : undefined,
        lastModified: entry.LastModified?.toISOString(),
        etag: entry.ETag,
      });
    }

    return {
      objects,
      nextCursor: response.IsTruncated ? response.NextContinuationToken : undefined,
    };
  }

  async put(input: { key: string; body: Buffer; contentType?: string }): Promise<PutResult> {
    const { key, body, contentType } = input;
    const ref = this.mintRef(key);

    await this.ensureBucketExists();
    await this.putObject(key, body, contentType);

    return {
      ref,
      url: this.getObjectUrl(key),
      pathname: key,
      provider: "s3",
    };
  }

  getObjectUrl(key: string): string {
    const config = this.config();

    // Note: URL generation is currently path-style only. If forcePathStyle is
    // false (virtual-hosted requests), promotion/read still work, but the
    // minted write URL may not match the provider's canonical host style.
    if (!config.forcePathStyle && !this.warnedVirtualHostedUrlLimitation) {
      this.warnedVirtualHostedUrlLimitation = true;
      console.warn(
        "[S3] STORAGE_S3_FORCE_PATH_STYLE=false is set, but getObjectUrl() still emits path-style URLs. Virtual-hosted URL minting is not implemented yet.",
      );
    }

    return `${config.publicEndpoint}/${config.bucket}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    const client = this.getClient();
    const config = this.config();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      throw new Error(
        `Failed to delete object "${key}" from S3 at ${config.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectOutcome[]> {
    if (keys.length === 0) {
      return [];
    }

    const client = this.getClient();
    const config = this.config();

    try {
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: false,
          },
        }),
      );

      const outcomeByKey = new Map<string, DeleteObjectOutcome>();

      for (const deleted of response.Deleted ?? []) {
        if (!deleted.Key) continue;
        outcomeByKey.set(deleted.Key, {
          key: deleted.Key,
          outcome: "deleted",
        });
      }

      for (const error of response.Errors ?? []) {
        if (!error.Key) continue;
        const code = error.Code ?? "DeleteError";
        const isNotFound = /NoSuchKey|NotFound|404/i.test(code);
        const isBlocked = !isNotFound && isS3BlockedDeleteError(code, error.Message);
        outcomeByKey.set(error.Key, {
          key: error.Key,
          outcome: isNotFound ? "not_found" : isBlocked ? "blocked" : "retryable",
          errorCode: code,
          message: error.Message,
        });
      }

      return keys.map((key) => {
        return outcomeByKey.get(key) ?? {
          key,
          outcome: "deleted",
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name =
        typeof err === "object" &&
        err &&
        "name" in err &&
        typeof (err as { name?: unknown }).name === "string"
          ? (err as { name: string }).name
          : "DeleteObjectsFailed";
      const blocked = isS3BlockedDeleteError(name, message);
      return keys.map((key) => ({
        key,
        outcome: blocked ? "blocked" : "retryable",
        errorCode: blocked ? name : "DeleteObjectsFailed",
        message: `Failed to batch delete object "${key}" from S3 at ${config.endpoint}: ${message}`,
      }));
    }
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 300,
  ): Promise<string> {
    const client = this.getClient();
    const config = this.config();
    try {
      return await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn },
      );
    } catch (err) {
      throw new Error(
        `Failed to generate presigned upload URL for "${key}" at ${config.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    const { ref, operation, contentType, expiresIn = 300 } = input;
    this.assertActiveRef(ref);

    await this.ensureBucketExists();
    if (operation === "put") {
      if (!contentType) {
        throw new Error("contentType is required when generating a PUT signed URL");
      }
      return this.getPresignedUploadUrl(ref.key, contentType, expiresIn);
    }

    return this.getPresignedDownloadUrl(ref.key, expiresIn);
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    const client = this.getClient();
    const config = this.config();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
        { expiresIn },
      );
    } catch (err) {
      throw new Error(
        `Failed to generate presigned download URL for "${key}" at ${config.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

let singletonAdapter: S3StorageAdapter | null = null;

export function getS3StorageAdapter(): S3StorageAdapter {
  if (!singletonAdapter) {
    singletonAdapter = new S3StorageAdapter();
  }
  return singletonAdapter;
}
