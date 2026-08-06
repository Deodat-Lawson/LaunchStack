const PARSE_BASE = "http://internal.invalid";
const INTERNAL_FILE_PATH = /^\/api\/files\/(\d+)$/;
const HTTP_URL_SCHEME = /^https?:\/\//i;
const ABSOLUTE_URL_SCHEME = /^[a-z][a-z\d+\-.]*:/i;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, PARSE_BASE);
  } catch {
    return null;
  }
}

function normalizedPath(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null;
  }

  return parsed.pathname.replace(/\/$/, "");
}

/**
 * Extract a database file id from a canonical /api/files/{id} URL.
 *
 * The host is intentionally ignored here. Callers that use this result for
 * authorization or capability minting must apply isInternalFileUrl() first.
 */
export function parseInternalFileId(url: string): number | null {
  const path = normalizedPath(url);
  const id = path ? INTERNAL_FILE_PATH.exec(path)?.[1] : undefined;
  if (!id) return null;

  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Build the only URL form that should be handed to the OCR worker for a
 * database-backed file. The configured app path is intentionally discarded.
 */
export function buildInternalFileUrl(
  appPublicUrl: string,
  fileId: number | string,
): string {
  const id = String(fileId);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error(`Invalid internal file id: ${id}`);
  }

  const configuredUrl = new URL(appPublicUrl);
  if (
    configuredUrl.protocol !== "http:" &&
    configuredUrl.protocol !== "https:"
  ) {
    throw new Error("APP_PUBLIC_URL must have an HTTP origin");
  }

  return new URL(`/api/files/${id}`, `${configuredUrl.origin}/`).toString();
}

/** Compare URL origins exactly, never by prefix or substring. */
export function originsEqual(
  url: string,
  appPublicUrl: string | undefined,
): boolean {
  if (!appPublicUrl) return false;

  const parsedUrl = parseUrl(url);
  const parsedAppUrl = parseUrl(appPublicUrl);
  if (!parsedUrl || !parsedAppUrl) return false;

  return parsedUrl.origin === parsedAppUrl.origin;
}

/**
 * Identify an internal file reference that is safe to authorize.
 *
 * Relative references are local by definition. Absolute references must use
 * the exact configured application origin; a foreign host with the same path
 * is an external URL and must never reach the file capability signer.
 */
export function isInternalFileUrl(
  url: string,
  appPublicUrl: string | undefined,
): boolean {
  if (parseInternalFileId(url) === null) return false;

  if (!ABSOLUTE_URL_SCHEME.test(url) && !url.startsWith("//")) {
    return true;
  }

  return HTTP_URL_SCHEME.test(url) && originsEqual(url, appPublicUrl);
}
