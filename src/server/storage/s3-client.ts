import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "~/env";

// ---------------------------------------------------------------------------
// Singleton S3 client — lazy-initialized on first use
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

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
