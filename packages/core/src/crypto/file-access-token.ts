import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived HMAC tokens that let trusted sidecars (the OCR worker) fetch a
 * database-backed file over HTTP without a browser session.
 *
 * `/api/files/{id}` is a session-protected route, but the OCR worker runs in a
 * separate container and pulls documents by URL, so it has no Clerk cookie.
 * Instead of poking a hole in the route, the app mints a token scoped to one
 * file id with a short expiry and appends it to the worker-reachable URL.
 *
 * Token format: `{expiresAtMs}.{hmacHex}` where the MAC covers `{fileId}:{exp}`.
 * Both halves are needed to verify, and neither the file id nor the expiry can
 * be changed without invalidating the MAC.
 *
 * Everything fails closed: with no secret configured, signing returns null and
 * verification returns false, so the route falls back to session-only auth.
 */

export const FILE_ACCESS_TOKEN_PARAM = "t";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function computeMac(fileId: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${fileId}:${expiresAt}`)
    .digest("hex");
}

/**
 * Mint a token granting read access to a single file id. Returns null when no
 * secret is configured — callers should treat that as "no token available"
 * rather than an error, since the secret is only required for deployments that
 * run the OCR worker against database-backed storage.
 */
export function signFileAccessToken(
  fileId: string,
  secret: string | undefined,
  options?: { ttlMs?: number; now?: number },
): string | null {
  if (!secret) return null;

  const now = options?.now ?? Date.now();
  const expiresAt = now + (options?.ttlMs ?? DEFAULT_TTL_MS);

  return `${expiresAt}.${computeMac(fileId, expiresAt, secret)}`;
}

/** Verify a token against the file id it is supposed to grant access to. */
export function verifyFileAccessToken(
  token: string | null | undefined,
  fileId: string,
  secret: string | undefined,
  options?: { now?: number },
): boolean {
  if (!token || !secret) return false;

  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiresAt = Number(token.slice(0, separator));
  const providedMac = token.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || providedMac.length === 0) return false;

  if (expiresAt <= (options?.now ?? Date.now())) return false;

  const expectedMac = Buffer.from(computeMac(fileId, expiresAt, secret), "hex");
  const provided = Buffer.from(providedMac, "hex");
  if (provided.length !== expectedMac.length) return false;

  return timingSafeEqual(provided, expectedMac);
}
