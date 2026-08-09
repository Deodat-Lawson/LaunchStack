/**
 * SSRF guard for user-supplied URLs that the server will fetch.
 *
 * `assertPublicHttpUrl` accepts only http(s) URLs whose host resolves to
 * publicly-routable addresses. Literal IPs and DNS names that resolve into
 * private, loopback, or link-local ranges are rejected so an attacker cannot
 * point an upload route at the metadata service, the database, a sidecar, or
 * anything else on the internal network.
 *
 * Known limitation (accepted at this hardening level): the DNS answer is
 * checked here but the actual fetch re-resolves the name, so a rebinding
 * attacker with a very short TTL could still swap the record between check
 * and use. Closing that requires pinning the resolved IP into the socket
 * connection, which the platform fetch does not expose.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Thrown when a URL fails the public-host policy. Message is safe to return to clients. */
export class UrlGuardError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UrlGuardError";
    }
}

function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // malformed: fail closed
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8 ("this network")
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
}

function isPrivateIPv6(ip: string): boolean {
    // Strip zone index (fe80::1%eth0) before classifying.
    const bare = ip.split("%")[0]!.toLowerCase();
    if (bare === "::" || bare === "::1") return true; // unspecified / loopback

    // IPv4-mapped or IPv4-compatible (::ffff:10.0.0.1) — classify the v4 part.
    const v4 = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
    if (v4) return isPrivateIPv4(v4[1]!);

    const firstGroup = bare.split(":")[0]!;
    // fc00::/7 unique local
    if (firstGroup.startsWith("fc") || firstGroup.startsWith("fd")) return true;
    // fe80::/10 link-local: fe80 - febf
    if (/^fe[89ab]/.test(firstGroup)) return true;
    return false;
}

/** True when the given literal IP (v4 or v6) is private/loopback/link-local. */
export function isPrivateAddress(ip: string): boolean {
    const family = isIP(ip);
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return true; // not an IP at all: fail closed
}

/**
 * Validate that `rawUrl` is an http(s) URL pointing at a public host.
 *
 * Throws `UrlGuardError` when the URL is malformed, uses a non-http scheme,
 * is a literal private IP, or resolves (via DNS) to any private address.
 * Returns the parsed URL on success.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new UrlGuardError("Invalid URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new UrlGuardError("Only http(s) URLs are supported");
    }

    // URL#hostname wraps IPv6 literals in brackets — strip them for isIP().
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (hostname.length === 0) {
        throw new UrlGuardError("Invalid URL");
    }

    if (isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new UrlGuardError("URL resolves to a private or internal address");
        }
        return parsed;
    }

    // "localhost" and friends may resolve to loopback; the lookup below
    // catches them, but bail early on the obvious one for a clearer error.
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        throw new UrlGuardError("URL resolves to a private or internal address");
    }

    let addresses: { address: string }[];
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new UrlGuardError("Unable to resolve URL host");
    }

    if (addresses.length === 0) {
        throw new UrlGuardError("Unable to resolve URL host");
    }

    for (const { address } of addresses) {
        if (isPrivateAddress(address)) {
            throw new UrlGuardError("URL resolves to a private or internal address");
        }
    }

    return parsed;
}
