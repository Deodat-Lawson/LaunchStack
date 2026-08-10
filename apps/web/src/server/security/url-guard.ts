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
import { isIP, isIPv6 } from "node:net";

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

/**
 * Expand an IPv6 literal into its 8 16-bit words. Handles `::` compression,
 * an embedded dotted-quad IPv4 tail (`::ffff:127.0.0.1`), and uppercase hex.
 * Returns null when the string is not a valid IPv6 address.
 */
function expandIPv6(ip: string): number[] | null {
    if (!isIPv6(ip)) return null;
    let hex = ip.toLowerCase();

    // Fold a dotted-quad tail into two hex words so every notation of the
    // same address expands to the same 8 words.
    const v4Tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(hex);
    if (v4Tail) {
        const octets = v4Tail[2]!.split(".").map(Number);
        if (octets.length !== 4 || octets.some(o => Number.isNaN(o) || o > 255)) return null;
        const [o1, o2, o3, o4] = octets as [number, number, number, number];
        hex = `${v4Tail[1]}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
    }

    const halves = hex.split("::");
    if (halves.length > 2) return null;

    const parseGroups = (s: string): number[] =>
        s === "" ? [] : s.split(":").map(group => parseInt(group, 16));

    let words: number[];
    if (halves.length === 2) {
        const left = parseGroups(halves[0]!);
        const right = parseGroups(halves[1]!);
        const fill = 8 - left.length - right.length;
        if (fill < 0) return null;
        words = [...left, ...(Array(fill).fill(0) as number[]), ...right];
    } else {
        words = parseGroups(hex);
    }

    if (words.length !== 8 || words.some(w => Number.isNaN(w) || w < 0 || w > 0xffff)) {
        return null;
    }
    return words;
}

/**
 * When the address sits in a prefix that embeds an IPv4 address in its low
 * 32 bits — IPv4-mapped `::ffff:0:0/96`, IPv4-compatible `::/96`, or NAT64
 * `64:ff9b::/96` — return that IPv4 in dotted form, else null. Works on the
 * expanded words, so hex (`::ffff:7f00:1`) and dotted (`::ffff:127.0.0.1`)
 * notations classify identically.
 */
function embeddedIPv4(words: number[]): string | null {
    const isMapped = words.slice(0, 5).every(w => w === 0) && words[5] === 0xffff;
    const isCompatible = words.slice(0, 6).every(w => w === 0);
    const isNat64 =
        words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every(w => w === 0);
    if (!isMapped && !isCompatible && !isNat64) return null;
    const hi = words[6]!;
    const lo = words[7]!;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIPv6(ip: string): boolean {
    // Strip zone index (fe80::1%eth0) before classifying.
    const bare = ip.split("%")[0]!;
    const words = expandIPv6(bare);
    if (!words) return true; // unparseable: fail closed

    if (words.every(w => w === 0)) return true; // :: unspecified
    if (words.slice(0, 7).every(w => w === 0) && words[7] === 1) return true; // ::1 loopback

    // Addresses that embed an IPv4 (mapped/compatible/NAT64) are classified
    // by that IPv4, regardless of notation — this is what closes the
    // `http://[::ffff:7f00:1]/` (hex-mapped 127.0.0.1) bypass.
    const v4 = embeddedIPv4(words);
    if (v4) return isPrivateIPv4(v4);

    const first = words[0]!;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
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

/** Maximum redirect hops `fetchPublicUrl` will follow before giving up. */
export const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch a user-supplied URL with the SSRF guard applied to EVERY hop of the
 * redirect chain, not just the first URL. A plain `fetch(url, { redirect:
 * "follow" })` after `assertPublicHttpUrl` is not enough: a public page can
 * 302 into `http://169.254.169.254/` and the runtime would follow it blind.
 *
 * Redirects are followed manually (max `MAX_REDIRECT_HOPS`), re-running
 * `assertPublicHttpUrl` on each Location target — including scheme checks, so
 * a redirect to `file:` or any non-http(s) scheme is refused. Throws
 * `UrlGuardError` when any hop fails the policy; otherwise returns the final
 * (non-redirect) response. `init.redirect` is always overridden to "manual".
 */
export async function fetchPublicUrl(rawUrl: string, init?: RequestInit): Promise<Response> {
    let currentUrl = (await assertPublicHttpUrl(rawUrl)).href;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const response = await fetch(currentUrl, { ...init, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status)) {
            return response;
        }

        const location = response.headers.get("location");
        // Release the intermediate response body before following the hop.
        try {
            await response.body?.cancel();
        } catch {
            // Body already consumed or errored — nothing to release.
        }

        if (!location) {
            throw new UrlGuardError("Redirect response is missing a Location header");
        }

        let next: URL;
        try {
            next = new URL(location, currentUrl); // relative Locations resolve against the current hop
        } catch {
            throw new UrlGuardError("Redirect target is not a valid URL");
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
            throw new UrlGuardError("Redirect target uses an unsupported scheme");
        }

        await assertPublicHttpUrl(next.href);
        currentUrl = next.href;
    }

    throw new UrlGuardError("Too many redirects");
}
