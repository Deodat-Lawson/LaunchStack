/**
 * Wire-protocol authentication.
 *
 * The hub is reachable from another machine, so these are the checks standing
 * between a meeting and anyone who can reach the port.
 */

import {
    canonicalString,
    COLLAB_API_PREFIX,
    NonceCache,
    signRequest,
    verifyRequest,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
} from "@launchstack/core/collab";

const SECRET = "shared-secret-between-the-two-machines";
const PATH = `${COLLAB_API_PREFIX}/nodes/poll`;
const BODY = JSON.stringify({ nodeId: "worker-a", waitMs: 100 });

function sign(overrides: Partial<Parameters<typeof signRequest>[0]> = {}) {
    return signRequest({
        secret: SECRET,
        method: "POST",
        path: PATH,
        body: BODY,
        nodeId: "worker-a",
        ...overrides,
    });
}

describe("collab request signing", () => {
    it("accepts a correctly signed request and reports the node", () => {
        const result = verifyRequest({
            secret: SECRET,
            method: "POST",
            path: PATH,
            body: BODY,
            headers: sign(),
        });
        expect(result).toEqual({ ok: true, nodeId: "worker-a" });
    });

    it("is case-insensitive about header casing", () => {
        const headers = sign();
        const upper = Object.fromEntries(
            Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v])
        );
        expect(
            verifyRequest({
                secret: SECRET,
                method: "POST",
                path: PATH,
                body: BODY,
                headers: upper,
            }).ok
        ).toBe(true);
    });

    it("rejects a wrong secret", () => {
        const result = verifyRequest({
            secret: "not-the-secret",
            method: "POST",
            path: PATH,
            body: BODY,
            headers: sign(),
        });
        expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });

    it("rejects a tampered body", () => {
        const headers = sign();
        const result = verifyRequest({
            secret: SECRET,
            method: "POST",
            path: PATH,
            body: JSON.stringify({ nodeId: "worker-a", waitMs: 999999 }),
            headers,
        });
        expect(result.reason).toBe("bad_signature");
    });

    it("rejects a tampered path, including its query string", () => {
        const signedPath = `${COLLAB_API_PREFIX}/channels/c1/messages?afterSeq=0`;
        const headers = signRequest({
            secret: SECRET,
            method: "GET",
            path: signedPath,
            body: "",
            nodeId: "worker-a",
        });

        expect(
            verifyRequest({
                secret: SECRET,
                method: "GET",
                path: `${COLLAB_API_PREFIX}/channels/c1/messages?afterSeq=9999`,
                body: "",
                headers,
            }).reason
        ).toBe("bad_signature");
    });

    it("rejects a tampered method", () => {
        expect(
            verifyRequest({
                secret: SECRET,
                method: "DELETE",
                path: PATH,
                body: BODY,
                headers: sign(),
            }).reason
        ).toBe("bad_signature");
    });

    it("rejects a stale timestamp outside the skew window", () => {
        const headers = sign({ timestamp: Date.now() - 10 * 60_000 });
        expect(
            verifyRequest({ secret: SECRET, method: "POST", path: PATH, body: BODY, headers })
                .reason
        ).toBe("stale_timestamp");
    });

    it("rejects a timestamp too far in the future", () => {
        const headers = sign({ timestamp: Date.now() + 10 * 60_000 });
        expect(
            verifyRequest({ secret: SECRET, method: "POST", path: PATH, body: BODY, headers })
                .reason
        ).toBe("stale_timestamp");
    });

    it("rejects a replayed nonce", () => {
        const nonces = new NonceCache();
        const headers = sign({ nonce: "fixed-nonce" });
        const args = { secret: SECRET, method: "POST", path: PATH, body: BODY, headers, nonces };

        expect(verifyRequest(args).ok).toBe(true);
        expect(verifyRequest(args).reason).toBe("replayed_nonce");
    });

    it("does not consume a nonce when the signature fails", () => {
        const nonces = new NonceCache();
        const headers = sign({ nonce: "unused-nonce" });

        expect(
            verifyRequest({
                secret: "wrong",
                method: "POST",
                path: PATH,
                body: BODY,
                headers,
                nonces,
            }).reason
        ).toBe("bad_signature");
        // The nonce is still available to the legitimate holder.
        expect(
            verifyRequest({
                secret: SECRET,
                method: "POST",
                path: PATH,
                body: BODY,
                headers,
                nonces,
            }).ok
        ).toBe(true);
    });

    it("rejects missing headers", () => {
        expect(
            verifyRequest({ secret: SECRET, method: "POST", path: PATH, body: BODY, headers: {} })
                .reason
        ).toBe("missing_headers");
        const partial = { ...sign() };
        delete (partial as Record<string, string>)[HEADER_SIGNATURE];
        expect(
            verifyRequest({
                secret: SECRET,
                method: "POST",
                path: PATH,
                body: BODY,
                headers: partial,
            }).reason
        ).toBe("missing_headers");
    });

    it("rejects a non-numeric timestamp rather than treating it as fresh", () => {
        const headers = { ...sign(), [HEADER_TIMESTAMP]: "not-a-number" };
        expect(
            verifyRequest({ secret: SECRET, method: "POST", path: PATH, body: BODY, headers })
                .reason
        ).toBe("stale_timestamp");
    });

    it("rejects an unsupported protocol version", () => {
        const headers = { ...sign(), "x-collab-version": "99" };
        expect(
            verifyRequest({ secret: SECRET, method: "POST", path: PATH, body: BODY, headers })
                .reason
        ).toBe("unsupported_version");
    });

    it("binds every field of the canonical string", () => {
        const base = { method: "POST", path: PATH, timestamp: "1", nonce: "n", body: BODY };
        const variants = [
            { ...base, method: "GET" },
            { ...base, path: `${PATH}x` },
            { ...base, timestamp: "2" },
            { ...base, nonce: "n2" },
            { ...base, body: `${BODY} ` },
        ];
        const canonical = canonicalString(base);
        for (const v of variants) {
            expect(canonicalString(v)).not.toBe(canonical);
        }
    });
});

describe("NonceCache", () => {
    it("evicts expired entries once it grows past its threshold", () => {
        const cache = new NonceCache(1_000);
        for (let i = 0; i < 600; i++) cache.claim(`n${i}`, 0);
        // Well past the TTL — a fresh claim triggers eviction and the old nonce
        // becomes reusable, which is safe because its signature is long stale.
        expect(cache.claim("trigger", 10_000)).toBe(true);
        expect(cache.claim("n0", 10_000)).toBe(true);
    });
});
