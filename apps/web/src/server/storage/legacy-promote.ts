import type { ObjectRef } from "@launchstack/core/storage";

import { env } from "~/env";
import {
  resolveStorageLocationId,
  storageLocationIdForS3,
  type StorageAdapter,
} from "~/lib/storage-location-id";

export interface LegacyPromotionInput {
  value: string | ObjectRef;
}

export type LegacyPromotionConfidence = "high" | "medium";

export type LegacyPromotionResult =
  | { ok: true; ref: ObjectRef; confidence: LegacyPromotionConfidence }
  | {
      ok: false;
      reason: "invalid" | "ambiguous" | "unsupported";
      quarantine: true;
    };

function isObjectRef(value: unknown): value is ObjectRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { adapter?: unknown }).adapter === "string" &&
      typeof (value as { storageLocationId?: unknown }).storageLocationId === "string" &&
      typeof (value as { key?: unknown }).key === "string",
  );
}

function toAbsoluteUrl(raw: string): URL | null {
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw);
    }

    if (raw.startsWith("/")) {
      const base = env.server.APP_PUBLIC_URL;
      if (!base) return null;
      return new URL(raw, base);
    }

    return null;
  } catch {
    return null;
  }
}

function promoteDatabaseUrl(raw: string): ObjectRef | null {
  let key: string | null = null;

  if (raw.startsWith("/")) {
    const relativeMatch = raw.match(/^\/api\/files\/(\d+)$/);
    key = relativeMatch?.[1] ?? null;
  } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const target = toAbsoluteUrl(raw);
    if (!target) return null;

    const absoluteMatch = target.pathname.match(/^\/api\/files\/(\d+)$/);
    if (!absoluteMatch?.[1]) return null;

    // Only allow absolute DB URLs from our own public app origin.
    // This avoids ambiguities like Blob URLs that can also contain /api/files/*.
    const appBase = env.server.APP_PUBLIC_URL;
    if (!appBase) return null;

    const appUrl = toAbsoluteUrl(appBase);
    if (!appUrl || target.origin !== appUrl.origin) return null;

    key = absoluteMatch[1];
  }

  if (!key) return null;

  return {
    adapter: "database",
    storageLocationId: resolveStorageLocationId("database"),
    key,
  };
}

function parseS3ObjectKeyFromUrl(raw: string): { key: string; locationId: string } | null {
  const endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;
  const bucket = env.server.S3_BUCKET_NAME;
  if (!endpoint || !bucket) return null;

  const target = toAbsoluteUrl(raw);
  if (!target) return null;

  const endpointUrl = toAbsoluteUrl(endpoint);
  if (!endpointUrl) return null;

  if (target.origin !== endpointUrl.origin) return null;

  const endpointPath = endpointUrl.pathname.replace(/\/+$/, "");
  const bucketPrefix = `${endpointPath}/${bucket}/`.replace(/\/\/+/, "/");

  if (!target.pathname.startsWith(bucketPrefix)) {
    return null;
  }

  const key = target.pathname.slice(bucketPrefix.length);
  if (!key) return null;

  return {
    key,
    locationId: storageLocationIdForS3(endpoint, bucket),
  };
}

function promoteS3Url(raw: string): ObjectRef | null {
  const parsed = parseS3ObjectKeyFromUrl(raw);
  if (!parsed) return null;

  return {
    adapter: "s3",
    storageLocationId: parsed.locationId,
    key: parsed.key,
  };
}

function promoteVercelBlobUrl(raw: string): ObjectRef | null {
  const target = toAbsoluteUrl(raw);
  if (!target) return null;

  if (!target.hostname.includes(".blob.vercel-storage.com")) {
    return null;
  }

  const key = target.pathname.replace(/^\/+/, "");
  if (!key) return null;

  return {
    adapter: "vercel-blob",
    storageLocationId: resolveStorageLocationId("vercel-blob"),
    key,
  };
}

function promoteUploadThingUrl(raw: string): ObjectRef | null {
  const target = toAbsoluteUrl(raw);
  if (!target) return null;

  const keyMatch = target.pathname.match(/\/f\/([^/?#]+)/);
  if (!keyMatch?.[1]) return null;

  if (!target.hostname.includes("utfs.io") && !target.hostname.includes("uploadthing.com")) {
    return null;
  }

  return {
    adapter: "uploadthing",
    storageLocationId: resolveStorageLocationId("uploadthing"),
    key: keyMatch[1],
  };
}

export function promoteLegacyUrlToRef(input: LegacyPromotionInput): LegacyPromotionResult {
  if (isObjectRef(input.value)) {
    return { ok: true, ref: input.value, confidence: "high" };
  }

  const raw = input.value.trim();
  if (!raw) {
    return {
      ok: false,
      reason: "invalid",
      quarantine: true,
    };
  }

  const candidates = [
    promoteDatabaseUrl(raw),
    promoteS3Url(raw),
    promoteVercelBlobUrl(raw),
    promoteUploadThingUrl(raw),
  ].filter(
    (value): value is ObjectRef => Boolean(value),
  );

  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      quarantine: true,
    };
  }

  const [candidate] = candidates;
  if (!candidate) {
    return {
      ok: false,
      reason: "unsupported",
      quarantine: true,
    };
  }

  return { ok: true, ref: candidate, confidence: "medium" };
}

export function assertPromotedLegacyRef(input: LegacyPromotionInput): ObjectRef {
  const promoted = promoteLegacyUrlToRef(input);
  if (!promoted.ok) {
    throw new Error(`Failed to promote legacy URL (${promoted.reason}).`);
  }
  return promoted.ref;
}

export function isStorageAdapter(value: string): value is StorageAdapter {
  return value === "s3" || value === "database" || value === "vercel-blob" || value === "uploadthing";
}
