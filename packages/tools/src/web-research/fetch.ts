/**
 * fetchReadable — one public web page as readable text, safely.
 *
 * Built for agent tools (distribution design §4.4 "fetch safety"): the
 * model may ask for any URL, so every hop is checked before a socket opens.
 *  - DNS is resolved first and private, loopback, link-local and
 *    carrier-grade-NAT ranges are refused (SSRF guard);
 *  - the socket connects to the addresses that were checked, not to a second
 *    DNS answer, so a host that answers public then private (DNS rebinding)
 *    cannot reach an internal service;
 *  - redirects are followed manually, at most three, each re-checked;
 *  - bodies are capped (2 MB default) and the cap is reported, not hidden;
 *  - scripts, styles and markup are stripped; whitespace is collapsed.
 *
 * Page content is *data*. Callers hand it to a model as untrusted text.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { ToolError } from "../contract";

export interface ReadablePage {
    /** The URL requested. */
    url: string;
    /** The URL that answered after redirects. */
    finalUrl: string;
    status: number;
    contentType: string | null;
    title: string | null;
    text: string;
    /** True when the body was cut at `maxBytes`. */
    truncated: boolean;
    fetchedAt: string;
}

export type HostLookup = (hostname: string) => Promise<string[]>;

export interface FetchReadableOptions {
    /** Body cap in bytes (default 2 MB). */
    maxBytes?: number;
    /** Whole-request timeout (default 15 s). */
    timeoutMs?: number;
    /** Redirect hops to follow (default 3). */
    maxRedirects?: number;
    signal?: AbortSignal;
    userAgent?: string;
    /** Injectable for tests; defaults to node:dns lookup(all). */
    lookup?: HostLookup;
    /** Injectable for tests; defaults to a fetch pinned to the checked addresses. */
    fetchImpl?: typeof fetch;
}

const DEFAULTS = {
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
    maxRedirects: 3,
    userAgent: "LaunchStackResearchBot/1.0 (+https://launchstack.dev)",
} as const;

export class UnsafeUrlError extends ToolError {
    constructor(message: string) {
        super({ code: "unsafe_url", status: 400, message });
        this.name = "UnsafeUrlError";
    }
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
        return null;
    }
    return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function inCidr(ip: number, base: string, bits: number): boolean {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (baseInt & mask) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
];

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
    const kind = isIP(address);
    if (kind === 4) {
        const ip = ipv4ToInt(address);
        if (ip === null) return true;
        return PRIVATE_V4.some(([base, bits]) => inCidr(ip, base, bits));
    }
    if (kind === 6) {
        const words = ipv6Words(address);
        if (!words) return true; // unparseable: fail closed
        if (words.every(w => w === 0)) return true; // :: unspecified
        if (words.slice(0, 7).every(w => w === 0) && words[7] === 1) return true; // ::1
        // An address that carries an IPv4 is judged by that IPv4, whatever
        // the notation: `new URL("http://[::ffff:127.0.0.1]/")` hands back
        // the host as `::ffff:7f00:1`, which a dotted-only check let through.
        const v4 = embeddedIPv4(words);
        if (v4) return isPrivateAddress(v4);
        const first = words[0]!;
        if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
        if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
        if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
        if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
        if (first === 0x2001 && words[1] === 0x0db8) return true; // 2001:db8::/32 documentation
        return false;
    }
    return true;
}

/**
 * An IPv6 literal as its eight 16-bit words: `::` expanded, a dotted IPv4
 * tail (`::ffff:127.0.0.1`) folded into two words, a zone (`%eth0`) dropped,
 * any case. Null when it is not an IPv6 address.
 */
function ipv6Words(address: string): number[] | null {
    let hex = address.split("%")[0]!.toLowerCase();
    if (isIP(hex) !== 6) return null;
    const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(hex);
    if (tail) {
        const octets = tail[2]!.split(".").map(Number);
        if (octets.some(o => o > 255)) return null;
        const [o1, o2, o3, o4] = octets as [number, number, number, number];
        hex = `${tail[1]}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
    }
    const halves = hex.split("::");
    if (halves.length > 2) return null;
    const groups = (part: string) => (part === "" ? [] : part.split(":").map(g => parseInt(g, 16)));
    let words: number[];
    if (halves.length === 2) {
        const left = groups(halves[0]!);
        const right = groups(halves[1]!);
        const fill = 8 - left.length - right.length;
        if (fill < 0) return null;
        words = [...left, ...new Array<number>(fill).fill(0), ...right];
    } else {
        words = groups(hex);
    }
    if (words.length !== 8 || words.some(w => Number.isNaN(w) || w < 0 || w > 0xffff)) return null;
    return words;
}

/**
 * The IPv4 an IPv6 address stands for, when it is in a prefix that embeds
 * one: IPv4-mapped `::ffff:0:0/96`, IPv4-compatible `::/96`, NAT64
 * `64:ff9b::/96` (all in the low 32 bits) and 6to4 `2002::/16` (bits 16–47).
 */
function embeddedIPv4(words: number[]): string | null {
    const dotted = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    const zeros = (from: number, to: number) => words.slice(from, to).every(w => w === 0);
    if (zeros(0, 5) && words[5] === 0xffff) return dotted(words[6]!, words[7]!); // mapped
    if (zeros(0, 6)) return dotted(words[6]!, words[7]!); // compatible
    if (words[0] === 0x0064 && words[1] === 0xff9b && zeros(2, 6)) {
        return dotted(words[6]!, words[7]!); // NAT64
    }
    if (words[0] === 0x2002) return dotted(words[1]!, words[2]!); // 6to4
    return null;
}

const defaultLookup: HostLookup = async hostname => {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    return records.map(r => r.address);
};

/** Throws UnsafeUrlError unless the URL is http(s) and resolves only to public addresses. */
export async function assertPublicUrl(
    rawUrl: string,
    lookup: HostLookup = defaultLookup
): Promise<URL> {
    return (await resolvePublicUrl(rawUrl, lookup)).url;
}

/**
 * A socket lookup that answers only with `addresses`, the ones already
 * checked, whatever DNS says now.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
    const entries = addresses.map(address => ({ address, family: isIP(address) }));
    return (_hostname, options, callback) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const matching = wanted ? entries.filter(e => e.family === wanted) : entries;
        const usable = matching.length > 0 ? matching : entries;
        if (options.all) {
            (callback as unknown as (err: null, list: typeof entries) => void)(null, usable);
        } else {
            callback(null, usable[0]!.address, usable[0]!.family);
        }
    };
}

/** `assertPublicUrl`, also returning the public addresses the host resolved to. */
async function resolvePublicUrl(
    rawUrl: string,
    lookup: HostLookup
): Promise<{ url: URL; addresses: string[] }> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new UnsafeUrlError(`Not a valid URL: ${rawUrl.slice(0, 200)}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new UnsafeUrlError(`Only http(s) URLs may be fetched (got ${url.protocol})`);
    }
    if (url.username || url.password) {
        throw new UnsafeUrlError("URLs with embedded credentials are refused");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        throw new UnsafeUrlError(`Refusing to fetch a local hostname: ${host}`);
    }
    if (isIP(host)) {
        if (isPrivateAddress(host)) throw new UnsafeUrlError(`Refusing private address ${host}`);
        return { url, addresses: [host] };
    }
    let addresses: string[];
    try {
        addresses = await lookup(host);
    } catch (error) {
        throw new ToolError({
            code: "dns_failed",
            status: 502,
            retryable: true,
            message: `Could not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    if (addresses.length === 0) {
        throw new ToolError({
            code: "dns_failed",
            status: 502,
            message: `No addresses for ${host}`,
        });
    }
    for (const address of addresses) {
        if (isPrivateAddress(address)) {
            throw new UnsafeUrlError(`Refusing ${host}: resolves to private address ${address}`);
        }
    }
    return { url, addresses };
}

const BLOCK_TAGS = new Set([
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "td",
    "th",
    "table",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "blockquote",
    "pre",
    "dd",
    "dt",
    "dl",
    "figcaption",
    "main",
]);

function decodeEntities(text: string): string {
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, code: string) => {
            const n = Number(code);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
            const n = Number.parseInt(hex, 16);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
        });
}

/** HTML → { title, text }: drops script/style/noscript/template/svg, keeps block breaks. */
export function htmlToReadableText(html: string): { title: string | null; text: string } {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch
        ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim() || null
        : null;

    let body = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(
            /<(script|style|noscript|template|svg|iframe|canvas|object)[^>]*>[\s\S]*?<\/\1>/gi,
            " "
        )
        .replace(/<head[^>]*>[\s\S]*?<\/head>/i, " ")
        .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, " ");

    // Preserve link targets as "text (href)" so evidence quotes keep their anchors.
    body = body.replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, href: string, inner: string) => {
            const text = inner
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            if (!text) return " ";
            return /^https?:\/\//i.test(href) ? ` ${text} (${href}) ` : ` ${text} `;
        }
    );

    body = body.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag: string) =>
        BLOCK_TAGS.has(tag.toLowerCase()) ? "\n" : " "
    );

    const text = decodeEntities(body)
        .replace(/[ \t\f\v ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return { title, text };
}

async function readBodyCapped(
    response: Response,
    maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
    if (!response.body) return { text: await response.text(), truncated: false };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > maxBytes) {
            const keep = value.byteLength - (received - maxBytes);
            if (keep > 0) chunks.push(value.subarray(0, keep));
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

export async function fetchReadable(
    rawUrl: string,
    options: FetchReadableOptions = {}
): Promise<ReadablePage> {
    const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
    const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
    const lookup = options.lookup ?? defaultLookup;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("fetch timed out")), timeoutMs);
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });
    // One connection pool per hop, each pinned to that hop's checked addresses.
    const agents: Agent[] = [];

    try {
        let { url: current, addresses } = await resolvePublicUrl(rawUrl, lookup);
        for (let hop = 0; ; hop++) {
            const init: RequestInit = {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    "User-Agent": options.userAgent ?? DEFAULTS.userAgent,
                    Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
                    "Accept-Language": "en,*;q=0.5",
                },
            };
            let response: Response;
            if (options.fetchImpl) {
                response = await options.fetchImpl(current.toString(), init);
            } else {
                const agent = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
                agents.push(agent);
                response = (await undiciFetch(current.toString(), {
                    ...(init as Parameters<typeof undiciFetch>[1]),
                    dispatcher: agent,
                })) as unknown as Response;
            }

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("location");
                if (!location) {
                    throw new ToolError({
                        code: "bad_redirect",
                        status: 502,
                        message: `Redirect without a Location header from ${current.hostname}`,
                    });
                }
                if (hop >= maxRedirects) {
                    throw new ToolError({
                        code: "too_many_redirects",
                        status: 502,
                        message: `More than ${maxRedirects} redirects starting at ${rawUrl}`,
                    });
                }
                await response.body?.cancel().catch(() => undefined);
                ({ url: current, addresses } = await resolvePublicUrl(
                    new URL(location, current).toString(),
                    lookup
                ));
                continue;
            }

            const contentType = response.headers.get("content-type");
            const { text: raw, truncated } = await readBodyCapped(response, maxBytes);
            const isHtml = !contentType || /html|xml/i.test(contentType);
            const readable = isHtml
                ? htmlToReadableText(raw)
                : { title: null, text: raw.replace(/\s+\n/g, "\n").trim() };

            return {
                url: rawUrl,
                finalUrl: current.toString(),
                status: response.status,
                contentType,
                title: readable.title,
                text: readable.text,
                truncated,
                fetchedAt: new Date().toISOString(),
            };
        }
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onOuterAbort);
        await Promise.all(agents.map(agent => agent.destroy().catch(() => undefined)));
    }
}
