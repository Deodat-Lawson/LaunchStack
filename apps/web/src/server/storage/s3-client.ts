import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "~/env";

// ---------------------------------------------------------------------------
// Singleton S3 client — lazy-initialized on first use
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;
let _bucketEnsured = false;

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: env.server.NEXT_PUBLIC_S3_ENDPOINT,
      region: env.server.S3_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: env.server.S3_ACCESS_KEY!,
        secretAccessKey: env.server.S3_SECRET_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

export function getS3BucketName(): string {
  return env.server.S3_BUCKET_NAME!;
}

// ---------------------------------------------------------------------------
// Bucket bootstrap — idempotent, runs once per process lifetime
// ---------------------------------------------------------------------------

export async function ensureBucketExists(): Promise<void> {
  if (_bucketEnsured) return;

  const client = getS3Client();
  const bucket = getS3BucketName();

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    // Bucket doesn't exist — create it
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[S3] Created bucket "${bucket}" at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}`);
    } catch (createErr) {
      throw new Error(
        `Failed to create S3 bucket "${bucket}" at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
      );
    }
  }

  _bucketEnsured = true;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export async function putObject(
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  const client = getS3Client();
  const bucket = getS3BucketName();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    throw new Error(
      `Failed to upload object "${key}" to S3 at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function getObjectUrl(key: string): string {
  const endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT!;
  const bucket = getS3BucketName();
  // Strip trailing slash from endpoint to avoid double-slash
  return `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();
  const bucket = getS3BucketName();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  } catch (err) {
    throw new Error(
      `Failed to delete object "${key}" from S3 at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface DeleteObjectOutcome {
  key: string;
  outcome: "deleted" | "not_found" | "retryable" | "blocked";
  errorCode?: string;
  message?: string;
}

function isS3BlockedDeleteError(code: string, message?: string): boolean {
  const haystack = `${code} ${message ?? ""}`;
  return /AccessDenied|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|ExpiredToken|Credentials|Credential|permission|AuthFailed/i.test(
    haystack,
  );
}

export async function deleteObjects(keys: string[]): Promise<DeleteObjectOutcome[]> {
  if (keys.length === 0) {
    return [];
  }

  const client = getS3Client();
  const bucket = getS3BucketName();

  try {
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
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
      message: `Failed to batch delete object "${key}" from S3 at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${message}`,
    }));
  }
}

// ---------------------------------------------------------------------------
// Presigned URLs
// ---------------------------------------------------------------------------

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  const client = getS3Client();
  const bucket = getS3BucketName();
  try {
    return await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn },
    );
  } catch (err) {
    throw new Error(
      `Failed to generate presigned upload URL for "${key}" at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 300,
): Promise<string> {
  const client = getS3Client();
  const bucket = getS3BucketName();
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn },
    );
  } catch (err) {
    throw new Error(
      `Failed to generate presigned download URL for "${key}" at ${env.server.NEXT_PUBLIC_S3_ENDPOINT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
