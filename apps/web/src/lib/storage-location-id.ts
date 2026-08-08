import { env } from "~/env";

export type StorageAdapter = "s3" | "vercel-blob" | "database" | "uploadthing";

const DATABASE_LOCATION_ID = "database:pdr_file_uploads_v1" as const;

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

/**
 * Frozen formula (Decision 4):
 *   s3:{NEXT_PUBLIC_S3_ENDPOINT}@{S3_BUCKET_NAME}
 */
export function storageLocationIdForS3(endpoint: string, bucket: string): string {
  return `s3:${normalizeEndpoint(endpoint)}@${bucket}`;
}

/**
 * Frozen formula (Decision 4):
 *   vercel-blob:{storeId}
 *
 * storeId must be parsed exactly like @vercel/blob@2.3.0:
 * token.split("_")[3]
 */
export function parseVercelBlobStoreIdFromToken(token: string): string | null {
  const storeId = token.split("_")[3]?.trim();
  return storeId && storeId.length > 0 ? storeId : null;
}

export function storageLocationIdForVercelBlob(storeId: string): string {
  return `vercel-blob:${storeId}`;
}

/**
 * Frozen formula (Decision 4):
 *   database:pdr_file_uploads_v1
 */
export function storageLocationIdForDatabase(): string {
  return DATABASE_LOCATION_ID;
}

/**
 * Frozen formula (Decision 4):
 *   uploadthing:{appId}[@region]
 */
export function storageLocationIdForUploadThing(appId: string, region?: string): string {
  const cleanRegion = region?.trim();
  return cleanRegion && cleanRegion.length > 0
    ? `uploadthing:${appId}@${cleanRegion}`
    : `uploadthing:${appId}`;
}

/**
 * Best-effort parser for UploadThing identity from env token.
 *
 * This intentionally fails closed when identity cannot be recovered.
 */
export function parseUploadThingIdentityFromToken(token: string): { appId: string; region?: string } | null {
  const raw = token.trim();
  if (!raw) return null;

  const jwtParts = raw.split(".");
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1]!, "base64url").toString("utf8")) as {
        appId?: unknown;
        region?: unknown;
      };
      if (typeof payload.appId === "string" && payload.appId.trim().length > 0) {
        return {
          appId: payload.appId.trim(),
          region: typeof payload.region === "string" && payload.region.trim().length > 0
            ? payload.region.trim()
            : undefined,
        };
      }
    } catch {
      // Fall through to underscore parser.
    }
  }

  const parts = raw.split("_").filter(Boolean);
  const appCandidate = parts.find((part) => /^[a-z0-9]{6,}$/i.test(part));
  if (!appCandidate) return null;

  const regionCandidate = parts.find((part) => /^(us|eu|ap|sa|au|me)-[a-z0-9-]+$/i.test(part));
  return { appId: appCandidate, region: regionCandidate };
}

export function resolveStorageLocationId(adapter: StorageAdapter): string {
  if (adapter === "database") {
    return DATABASE_LOCATION_ID;
  }

  if (adapter === "s3") {
    const endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;
    const bucket = env.server.S3_BUCKET_NAME;

    if (!endpoint || !bucket) {
      throw new Error(
        "Cannot resolve storageLocationId for s3: NEXT_PUBLIC_S3_ENDPOINT and S3_BUCKET_NAME must be configured.",
      );
    }

    return storageLocationIdForS3(endpoint, bucket);
  }

  if (adapter === "vercel-blob") {
    const token = env.server.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw new Error("Cannot resolve storageLocationId for vercel-blob: BLOB_READ_WRITE_TOKEN is not configured.");
    }

    const storeId = parseVercelBlobStoreIdFromToken(token);
    if (!storeId) {
      throw new Error(
        "Cannot resolve storageLocationId for vercel-blob: BLOB_READ_WRITE_TOKEN is unparseable (expected token.split(\"_\")[3]).",
      );
    }

    return storageLocationIdForVercelBlob(storeId);
  }

  const uploadThingToken = env.server.UPLOADTHING_TOKEN ?? process.env.UPLOADTHING_TOKEN;
  if (!uploadThingToken) {
    throw new Error("Cannot resolve storageLocationId for uploadthing: UPLOADTHING_TOKEN is not configured.");
  }

  const parsed = parseUploadThingIdentityFromToken(uploadThingToken);
  if (!parsed) {
    throw new Error("Cannot resolve storageLocationId for uploadthing: UPLOADTHING_TOKEN is unparseable.");
  }

  return storageLocationIdForUploadThing(parsed.appId, parsed.region);
}
