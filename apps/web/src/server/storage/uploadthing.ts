import type { ObjectRef } from "@launchstack/core/storage";

import { env } from "~/env";
import {
  parseUploadThingIdentityFromToken,
  storageLocationIdForUploadThing,
} from "~/lib/storage-location-id";

export interface UploadThingCallbackFile {
  key?: string | null;
  url?: string | null;
  ufsUrl?: string | null;
}

function getUploadThingToken(): string {
  const token = env.server.UPLOADTHING_TOKEN ?? process.env.UPLOADTHING_TOKEN;
  if (!token) {
    throw new Error("UPLOADTHING_TOKEN is not configured.");
  }
  return token;
}

function extractUploadThingKeyFromUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\/f\/([^/?#]+)/);
    const key = match?.[1]?.trim();
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function extractUploadThingFileKey(file: UploadThingCallbackFile): string {
  const explicitKey = file.key?.trim();
  if (explicitKey && explicitKey.length > 0) {
    return explicitKey;
  }

  const fromUfsUrl = file.ufsUrl ? extractUploadThingKeyFromUrl(file.ufsUrl) : null;
  if (fromUfsUrl) {
    return fromUfsUrl;
  }

  const fromUrl = file.url ? extractUploadThingKeyFromUrl(file.url) : null;
  if (fromUrl) {
    return fromUrl;
  }

  throw new Error("UploadThing callback did not include a usable file key.");
}

export function mintUploadThingObjectRef(file: UploadThingCallbackFile): ObjectRef {
  const token = getUploadThingToken();
  const identity = parseUploadThingIdentityFromToken(token);
  if (!identity) {
    throw new Error("UPLOADTHING_TOKEN is unparseable.");
  }

  return {
    adapter: "uploadthing",
    storageLocationId: storageLocationIdForUploadThing(identity.appId, identity.region),
    key: extractUploadThingFileKey(file),
  };
}

export async function deleteUploadThingFileByKey(
  key: string,
): Promise<{ outcome: "deleted" | "not_found" | "retryable" | "blocked"; errorCode?: string; message?: string }> {
  const isBlocked = (text: string): boolean =>
    /Unauthorized|Forbidden|AccessDenied|InvalidToken|Credentials|Credential|permission|not configured|unparseable|misconfigured/i.test(
      text,
    );

  try {
    const token = getUploadThingToken();
    const { UTApi } = await import("uploadthing/server");

    const utapi = new UTApi({ token });
    const response = (await utapi.deleteFiles(key)) as {
      success?: boolean;
      deletedCount?: number;
      message?: string;
    };

    if (!response.success) {
      const message = response.message ?? "UploadThing delete returned success=false.";
      if (isBlocked(message)) {
        return {
          outcome: "blocked",
          errorCode: "uploadthing_auth_or_config_error",
          message,
        };
      }

      return {
        outcome: "retryable",
        errorCode: "uploadthing_delete_failed",
        message,
      };
    }

    if (response.deletedCount === 0) {
      return { outcome: "not_found" };
    }

    return { outcome: "deleted" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" &&
      err &&
      "name" in err &&
      typeof (err as { name?: unknown }).name === "string"
        ? (err as { name: string }).name
        : "uploadthing_delete_failed";

    if (isBlocked(`${code} ${message}`)) {
      return {
        outcome: "blocked",
        errorCode: code,
        message,
      };
    }

    return {
      outcome: "retryable",
      errorCode: code,
      message,
    };
  }
}
