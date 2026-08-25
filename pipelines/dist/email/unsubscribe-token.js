import { createHmac, timingSafeEqual } from "node:crypto";
/**
 * Signed, opaque unsubscribe tokens.
 *
 * An unsubscribe link built from a plain `{companyId}/{email}` path is a
 * suppression primitive handed to the internet: anyone can guess a competitor's
 * company id, walk a list of addresses, and silence them. The link has to prove
 * that *we* issued it for *that* address, which is what the HMAC does.
 *
 * The token carries the company and address in the clear (base64url) plus a
 * signature over both. Nothing here is secret — the signature only establishes
 * issuance, so a leaked token unsubscribes exactly the address already written
 * inside it.
 */
const VERSION = "v1";
export class UnsubscribeSecretMissingError extends Error {
    constructor() {
        super(
            "EMAIL_UNSUBSCRIBE_SECRET is not set. Unsubscribe links cannot be issued " +
                "or verified without it; set it to a long random string."
        );
        this.name = "UnsubscribeSecretMissingError";
    }
}
/**
 * HMAC-SHA256 keys shorter than this add no meaningful security; a short
 * secret is almost always a placeholder that leaked into production.
 * Note: rotating the secret invalidates every unsubscribe link in
 * already-delivered mail — there is no key id in the token (yet).
 */
const MIN_SECRET_LENGTH = 16;
function secret(env = process.env) {
    const value = env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
    if (!value) throw new UnsubscribeSecretMissingError();
    if (value.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `EMAIL_UNSUBSCRIBE_SECRET must be at least ${MIN_SECRET_LENGTH} characters; ` +
                "set it to a long random string."
        );
    }
    return value;
}
function b64url(input) {
    return Buffer.from(input, "utf8").toString("base64url");
}
function sign(payload, key) {
    return createHmac("sha256", key).update(payload).digest("base64url");
}
/**
 * Mint a token for one address of one company. The address is lower-cased
 * first so the token matches the form the suppression list stores.
 */
export function createUnsubscribeToken(claims, env) {
    const payload = `${VERSION}.${claims.companyId}.${b64url(claims.email.toLowerCase())}`;
    return `${payload}.${sign(payload, secret(env))}`;
}
/**
 * Verify a token and return what it authorises, or null if it was not issued
 * by us. Comparison is constant-time so a caller cannot search for a valid
 * signature a byte at a time.
 */
export function verifyUnsubscribeToken(token, env) {
    const parts = token.split(".");
    if (parts.length !== 4) return null;
    const [version, rawCompanyId, rawEmail, signature] = parts;
    if (version !== VERSION) return null;
    const payload = `${version}.${rawCompanyId}.${rawEmail}`;
    const expected = sign(payload, secret(env));
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const companyId = Number(rawCompanyId);
    if (!Number.isInteger(companyId) || companyId <= 0) return null;
    let email;
    try {
        email = Buffer.from(rawEmail, "base64url").toString("utf8");
    } catch {
        return null;
    }
    if (!email.includes("@")) return null;
    return { companyId, email };
}
//# sourceMappingURL=unsubscribe-token.js.map
