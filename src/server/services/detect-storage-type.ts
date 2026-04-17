export type StorageType = "s3" | "database";

/**
 * Classifies a document URL. `/api/files/...` is served from Postgres
 * (base64 blob); anything else is assumed to be an S3-compatible endpoint.
 */
export function detectStorageType(url: string): StorageType {
  if (url.startsWith("/api/files/")) {
    return "database";
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return "s3";
  }
  return "database";
}

/**
 * Converts a relative URL to an absolute URL using the current request origin.
 */
export function toAbsoluteUrl(url: string, requestUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  const parsedUrl = new URL(requestUrl);
  const origin = parsedUrl.origin;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
