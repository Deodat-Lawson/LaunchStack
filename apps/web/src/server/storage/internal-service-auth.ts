/**
 * Internal service authentication for server-to-server file fetches (B8).
 *
 * WHY THIS EXISTS
 * ---------------
 * /api/files/[id] serves file bytes keyed on a raw file_uploads id. It needs a
 * tenant check (B8) — but it is also fetched by the app itself, not just by
 * browsers: the ingestion/OCR path downloads uploaded documents through
 * getStoragePort().download(), which resolves to a plain HTTP request carrying
 * no session cookie. A tenant check that only understands logged-in users
 * would refuse those requests and break document processing, and the breakage
 * would surface as a failed upload rather than as an auth error.
 *
 * So the route needs a second way to recognise a caller it can trust. This is
 * that: a shared secret the app sends to itself, checked with a constant-time
 * comparison so the header can't be brute-forced by timing.
 *
 * This is deliberately NOT a user identity. An internal caller is trusted to
 * be the app, not to be any particular company — it bypasses the tenant check
 * rather than satisfying it. The blast radius is exactly "our own server can
 * read any file", which is already true of any code holding a database
 * connection.
 *
 * If INTERNAL_SERVICE_TOKEN is unset, nothing can present valid internal
 * credentials, and the tenant check's default mode falls back to log-only
 * rather than refusing every ingestion fetch. See getFileTenantAuthMode.
 */

import { timingSafeEqual } from "node:crypto";

export const INTERNAL_SERVICE_HEADER = "x-launchstack-internal";

export function getInternalServiceToken(): string | undefined {
  const value = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  return value ? value : undefined;
}

/** True when a shared secret is configured at all. */
export function isInternalServiceAuthConfigured(): boolean {
  return getInternalServiceToken() !== undefined;
}

/** Headers to attach when this app calls one of its own endpoints. */
export function internalServiceHeaders(): Record<string, string> {
  const token = getInternalServiceToken();
  return token ? { [INTERNAL_SERVICE_HEADER]: token } : {};
}

/**
 * Constant-time comparison. Length is compared first and separately — that
 * leaks only the length of the configured token, which is not a secret, and
 * timingSafeEqual throws on a length mismatch rather than returning false.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when this request carries the configured internal service token. */
export function isInternalServiceRequest(request: Request): boolean {
  const expected = getInternalServiceToken();
  if (!expected) return false;

  const presented = request.headers.get(INTERNAL_SERVICE_HEADER);
  if (!presented) return false;

  return secretsMatch(presented, expected);
}
