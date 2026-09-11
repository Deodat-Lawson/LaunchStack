/**
 * fetchReadable — one public web page as readable text, safely.
 *
 * Built for agent tools (distribution design §4.4 "fetch safety"): the
 * model may ask for any URL, so every hop is checked before a socket opens.
 *  - DNS is resolved first and private, loopback, link-local and
 *    carrier-grade-NAT ranges are refused (SSRF guard);
 *  - redirects are followed manually, at most three, each re-checked;
 *  - bodies are capped (2 MB default) and the cap is reported, not hidden;
 *  - scripts, styles and markup are stripped; whitespace is collapsed.
 *
 * Page content is *data*. Callers hand it to a model as untrusted text.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

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
    /** Injectable for tests; defaults to global fetch. */
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
        const lower = address.toLowerCase();
        if (lower === "::" || lower === "::1") return true;
        // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded v4.
        const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
        if (mapped) return isPrivateAddress(mapped[1]!);
        if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
        if (/^fe[89ab]/.test(lower)) return true; // fe80::/10
        if (lower.startsWith("ff")) return true; // multicast
        if (lower.startsWith("2001:db8")) return true; // documentation
        return false;
    }
    return true;
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
        return url;
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
    return url;
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
    const fetchImpl = options.fetchImpl ?? fetch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("fetch timed out")), timeoutMs);
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
        let current = await assertPublicUrl(rawUrl, lookup);
        for (let hop = 0; ; hop++) {
            const response = await fetchImpl(current.toString(), {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    "User-Agent": options.userAgent ?? DEFAULTS.userAgent,
                    Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
                    "Accept-Language": "en,*;q=0.5",
                },
            });

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
                current = await assertPublicUrl(new URL(location, current).toString(), lookup);
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
    }
}
