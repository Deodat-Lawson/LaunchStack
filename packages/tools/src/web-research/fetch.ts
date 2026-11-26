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
 *  - scripts, styles and markup are stripped; whitespace is collapsed;
 *  - the page's links are kept beside the text, each with its target and
 *    its words, so a caller can follow a site's own navigation.
 *
 * Page content is *data*. Callers hand it to a model as untrusted text.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { ToolError } from "../contract";

/** One link of a fetched page. */
export interface PageLink {
    /** Where it points: an absolute http(s) URL, without its fragment. */
    url: string;
    /**
     * The link's words: its visible text, or for an icon link its aria-label,
     * title or image alt. Empty when it has none.
     */
    text: string;
}

export interface ReadablePage {
    /** The URL requested. */
    url: string;
    /** The URL that answered after redirects. */
    finalUrl: string;
    status: number;
    contentType: string | null;
    title: string | null;
    text: string;
    /**
     * Every link of the page in document order, relative targets resolved
     * against the URL that answered. `text` keeps a link's words but only an
     * absolute target, so the page's own navigation is read from here. Absent
     * when the response was not HTML, or when a page did not come from
     * `fetchReadable`.
     */
    links?: PageLink[];
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

/**
 * Named entities that turn up in link words (German, Scandinavian, Dutch and
 * French navigation, and the arrows around "next"). `decodeEntities` handles
 * the numeric ones.
 */
const LINK_TEXT_ENTITIES: Record<string, string> = {
    uuml: "ü",
    Uuml: "Ü",
    ouml: "ö",
    Ouml: "Ö",
    auml: "ä",
    Auml: "Ä",
    szlig: "ß",
    oslash: "ø",
    Oslash: "Ø",
    aring: "å",
    Aring: "Å",
    aelig: "æ",
    AElig: "Æ",
    eacute: "é",
    Eacute: "É",
    egrave: "è",
    Egrave: "È",
    euml: "ë",
    iuml: "ï",
    raquo: " ",
    laquo: " ",
    rsaquo: " ",
    lsaquo: " ",
    ndash: "-",
    mdash: "-",
};

function decodeLinkText(text: string): string {
    return decodeEntities(text).replace(
        /&([a-z]+);/gi,
        (whole, name: string) =>
            LINK_TEXT_ENTITIES[name] ?? LINK_TEXT_ENTITIES[name.toLowerCase()] ?? whole
    );
}

const ATTRIBUTE_PATTERNS = new Map<string, RegExp>();

/** The decoded value of one attribute of a tag, or null when the tag does not carry it. */
function attributeValue(attributes: string, name: string): string | null {
    let pattern = ATTRIBUTE_PATTERNS.get(name);
    if (!pattern) {
        pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
        ATTRIBUTE_PATTERNS.set(name, pattern);
    }
    const match = pattern.exec(attributes);
    if (!match) return null;
    return decodeLinkText(match[1] ?? match[2] ?? match[3] ?? "").trim();
}

function firstNonEmpty(...values: Array<string | null>): string {
    for (const value of values) if (value) return value;
    return "";
}

/** The most links kept per page; far above any real navigation. */
export const MAX_PAGE_LINKS = 5_000;

/**
 * HTML → the page's links, in document order, one entry per `<a href>`.
 *
 * Relative targets are resolved against `pageUrl` (or the page's `<base>`),
 * fragments are dropped, and only http(s) targets are kept: a link to a place
 * on the same page, a `mailto:` or a script is not somewhere a reader can go.
 * A link drawn as an icon has no text of its own, so its aria-label, title or
 * image alt stands in.
 */
export function extractPageLinks(
    html: string,
    pageUrl: string,
    maxLinks: number = MAX_PAGE_LINKS
): PageLink[] {
    let page: URL;
    try {
        page = new URL(pageUrl);
    } catch {
        return [];
    }
    const body = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    let base = page;
    const baseTag = /<base\b([^>]*)>/i.exec(body);
    const baseHref = baseTag ? attributeValue(baseTag[1] ?? "", "href") : null;
    if (baseHref) {
        try {
            base = new URL(baseHref, page);
        } catch {
            base = page;
        }
    }
    const links: PageLink[] = [];
    for (const match of body.matchAll(/<a\b([^>]*)>([\s\S]{0,4000}?)<\/a\s*>/gi)) {
        if (links.length >= maxLinks) break;
        const attributes = match[1] ?? "";
        const href = attributeValue(attributes, "href");
        if (!href || href.startsWith("#")) continue;
        let target: URL;
        try {
            target = new URL(href, base);
        } catch {
            continue;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") continue;
        target.hash = "";
        const inner = match[2] ?? "";
        const visible = decodeLinkText(inner.replace(/<[^>]*>/g, " "))
            .replace(/\s+/g, " ")
            .trim();
        const text = firstNonEmpty(
            visible,
            attributeValue(attributes, "aria-label"),
            attributeValue(attributes, "title"),
            attributeValue(/<img\b([^>]*)>/i.exec(inner)?.[1] ?? "", "alt")
        );
        links.push({ url: target.href, text });
    }
    return links;
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
                ...(isHtml ? { links: extractPageLinks(raw, current.toString()) } : {}),
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
