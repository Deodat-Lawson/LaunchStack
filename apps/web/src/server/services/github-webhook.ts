/**
 * GitHub webhook signature verification (X-Hub-Signature-256). Separate from
 * the route so it can be unit-tested without Next's request machinery.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
    secret: string,
    rawBody: string,
    signatureHeader: string | null
): boolean {
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = signatureHeader.slice("sha256=".length);
    if (provided.length !== expected.length) return false;
    try {
        return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
    } catch {
        return false;
    }
}
