/**
 * Time-limited, signed references for /api/files/{id} plus the service-to-
 * service bypass used by compute services (e.g. document-converter) that
 * fetch file URLs without a browser session.
 *
 * Modes, keyed off FILE_ACCESS_HMAC_KEY:
 *  - key set: /api/files/{id} requires a Clerk session, OR a valid
 *    `?exp=<unix>&sig=<hmac>` signed reference, OR an `X-Service-Key` header
 *    equal to the key.
 *  - key unset: legacy-open compatibility mode — the route serves files with
 *    no auth (as it always did) but logs one loud warning per process so the
 *    insecure state is visible.
 *
 * NOTE: FILE_ACCESS_HMAC_KEY is deliberately read from process.env here and
 * NOT registered in ~/env.ts — env.ts is frozen by a concurrent workstream.
 * The variable is optional and documented in .env.example under
 * "File access signing / service auth".
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 15 * 60;

export function getFileAccessKey(): string | undefined {
    const key = process.env.FILE_ACCESS_HMAC_KEY?.trim();
    // An empty (or whitespace-only) key must behave like an unset key, so a
    // plain `??` is not equivalent here.
    if (!key) return undefined;
    return key;
}

let warnedLegacyOpen = false;

/**
 * Emit a single startup-style warning (once per process) when files are being
 * served in legacy-open mode because FILE_ACCESS_HMAC_KEY is unset.
 */
export function warnLegacyOpenFileAccessOnce(): void {
    if (warnedLegacyOpen) return;
    warnedLegacyOpen = true;
    console.warn(
        "[SECURITY] FILE_ACCESS_HMAC_KEY is not set — /api/files/{id} is serving stored files WITHOUT authentication (legacy compatibility mode). Set FILE_ACCESS_HMAC_KEY to require a session or a signed/time-limited reference."
    );
}

/** Test hook: reset the once-per-process warning latch. */
export function __resetFileAccessWarningForTests(): void {
    warnedLegacyOpen = false;
}

function computeSignature(fileId: number, exp: number, key: string): string {
    return createHmac("sha256", key).update(`${fileId}.${exp}`).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

/**
 * Build a relative signed URL for a stored file, valid for `ttlSeconds`.
 * Throws when FILE_ACCESS_HMAC_KEY is not configured — callers in legacy-open
 * deployments should use the plain `/api/files/{id}` URL instead.
 */
export function signedFileUrl(fileId: number, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
    const key = getFileAccessKey();
    if (!key) {
        throw new Error("signedFileUrl requires FILE_ACCESS_HMAC_KEY to be configured");
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
        throw new Error(`signedFileUrl: invalid file id ${fileId}`);
    }
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
    const sig = computeSignature(fileId, exp, key);
    return `/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

/**
 * Verify an `?exp=&sig=` signed reference for the given file id.
 * Returns false when the key is unset, the signature is wrong, or the
 * reference has expired.
 */
export function verifySignedFileReference(
    fileId: number,
    expRaw: string | null,
    sigRaw: string | null
): boolean {
    const key = getFileAccessKey();
    if (!key || !expRaw || !sigRaw) return false;

    const exp = Number(expRaw);
    if (!Number.isInteger(exp)) return false;
    if (exp < Math.floor(Date.now() / 1000)) return false;

    const expected = computeSignature(fileId, exp, key);
    return timingSafeStringEqual(expected, sigRaw);
}

/**
 * Service-to-service bypass: an `X-Service-Key` header whose value equals
 * FILE_ACCESS_HMAC_KEY. Simpler than signing for compute services that fetch
 * many /api/files/ URLs.
 */
export function isValidServiceKey(headerValue: string | null): boolean {
    const key = getFileAccessKey();
    if (!key || !headerValue) return false;
    return timingSafeStringEqual(key, headerValue);
}
