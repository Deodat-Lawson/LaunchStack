/**
 * What the experiment reads from raw responses that production throws away:
 * the links of a page (production's readable text drops relative link
 * targets), the rules of a robots.txt and the URLs of a sitemap.
 */
import { normalizeUrlForMatch } from "../../../src/distribution/dossier-agent";

/** Same site: the same hostname, with or without a leading "www.". */
export function bareHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

export function sameSite(a: string, b: string): boolean {
    return bareHost(a) === bareHost(b);
}

/** Production's key for "this page was already fetched". */
export function urlKey(url: string): string {
    return normalizeUrlForMatch(url);
}

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
        })
        .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole);
}

const NAMED: Record<string, string> = {
    uuml: "ü",
    ouml: "ö",
    auml: "ä",
    szlig: "ß",
    oslash: "ø",
    aring: "å",
    aelig: "æ",
    eacute: "é",
    egrave: "è",
    euml: "ë",
    iuml: "ï",
    raquo: " ",
    laquo: " ",
    rsaquo: " ",
    lsaquo: " ",
    ndash: "-",
    mdash: "-",
};

function attribute(attributes: string, name: string): string | null {
    const match = new RegExp(
        `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
        "i"
    ).exec(attributes);
    if (!match) return null;
    return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
}

function firstNonEmpty(...values: Array<string | null>): string {
    for (const value of values) if (value !== null && value !== "") return value;
    return "";
}

function visibleText(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

/** Files, not pages: never a candidate. */
const FILE_EXTENSION =
    /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|odt|csv|mp[34]|m4[av]|mov|avi|wmv|webm|wav|ogg|exe|dmg|apk|ics|vcf|xml|json|rss|atom|css|js|woff2?|ttf|eot|txt)$/i;

export interface PageLink {
    /** Absolute URL, no fragment, on the page's own host and scheme. */
    url: string;
    key: string;
    /** Every distinct anchor text that points at this URL, in page order. */
    anchors: string[];
    /** Position of the first occurrence among the page's same-site links. */
    order: number;
}

/**
 * The distinct same-site page links of an HTML document, in page order.
 * Skips other hosts (subdomains included), files, fragments of the page
 * itself and non-web schemes.
 */
export function extractLinks(html: string, pageUrl: string): PageLink[] {
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
    const baseHref = baseTag ? attribute(baseTag[1] ?? "", "href") : null;
    if (baseHref) {
        try {
            base = new URL(baseHref, page);
        } catch {
            base = page;
        }
    }
    const pageKey = urlKey(page.href);
    const found = new Map<string, PageLink>();
    const anchorTag = /<a\b([^>]*)>([\s\S]{0,4000}?)<\/a\s*>/gi;
    for (const match of body.matchAll(anchorTag)) {
        const attributes = match[1] ?? "";
        const href = attribute(attributes, "href");
        if (!href || href.startsWith("#")) continue;
        let target: URL;
        try {
            target = new URL(href, base);
        } catch {
            continue;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") continue;
        if (!sameSite(target.hostname, page.hostname)) continue;
        // One spelling per page: the scheme and host the page itself answered on.
        target.protocol = page.protocol;
        target.hostname = page.hostname;
        target.port = page.port;
        target.hash = "";
        target.username = "";
        target.password = "";
        if (FILE_EXTENSION.test(target.pathname)) continue;
        if (target.pathname.startsWith("/cdn-cgi/")) continue;
        const key = urlKey(target.href);
        if (key === pageKey) continue;
        const inner = match[2] ?? "";
        // An icon link has no text of its own: fall back to its label, title or image.
        const text = firstNonEmpty(
            visibleText(inner),
            attribute(attributes, "aria-label"),
            attribute(attributes, "title"),
            attribute(/<img\b([^>]*)>/i.exec(inner)?.[1] ?? "", "alt")
        );
        const known = found.get(key);
        if (known) {
            if (text && !known.anchors.includes(text) && known.anchors.length < 6)
                known.anchors.push(text);
            continue;
        }
        found.set(key, {
            url: target.href,
            key,
            anchors: text ? [text] : [],
            order: found.size,
        });
    }
    return [...found.values()];
}

// ─── robots.txt ──────────────────────────────────────────────────────────────

interface RobotsRule {
    allow: boolean;
    pattern: RegExp;
    length: number;
}

export interface Robots {
    /** False when a `Disallow` for `*` covers this path (longest match wins, ties allow). */
    allows(url: string): boolean;
    sitemaps: string[];
    rules: number;
}

export const ALLOW_ALL: Robots = { allows: () => true, sitemaps: [], rules: 0 };

function rulePattern(value: string): RegExp {
    const anchored = value.endsWith("$");
    const core = anchored ? value.slice(0, -1) : value;
    const source = core
        .split("*")
        .map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/** The rules a robots.txt gives to every crawler (`User-agent: *`), and its sitemaps. */
export function parseRobots(text: string): Robots {
    const sitemaps: string[] = [];
    const rules: RobotsRule[] = [];
    let groupAgents: string[] = [];
    let lastWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const field = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (field === "sitemap") {
            if (/^https?:\/\//i.test(value)) sitemaps.push(value);
            continue;
        }
        if (field === "user-agent") {
            if (!lastWasAgent) groupAgents = [];
            groupAgents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (field !== "allow" && field !== "disallow") continue;
        if (!groupAgents.includes("*") || value === "") continue;
        try {
            rules.push({
                allow: field === "allow",
                pattern: rulePattern(value),
                length: value.length,
            });
        } catch {
            /* an unparseable rule restricts nothing */
        }
    }
    return {
        sitemaps,
        rules: rules.length,
        allows(url: string): boolean {
            let target: string;
            try {
                const u = new URL(url);
                target = `${u.pathname}${u.search}`;
            } catch {
                return false;
            }
            let verdict = true;
            let longest = -1;
            for (const rule of rules) {
                if (!rule.pattern.test(target)) continue;
                if (rule.length > longest || (rule.length === longest && rule.allow)) {
                    longest = rule.length;
                    verdict = rule.allow;
                }
            }
            return verdict;
        },
    };
}

// ─── sitemaps ────────────────────────────────────────────────────────────────

export interface ParsedSitemap {
    kind: "urlset" | "index" | "none";
    /** At most `cap` entries, in file order. */
    locs: string[];
    /** Entries in the file before the cap. */
    total: number;
}

export function parseSitemap(xml: string, cap = 200): ParsedSitemap {
    const kind = /<sitemapindex\b/i.test(xml)
        ? "index"
        : /<urlset\b/i.test(xml)
          ? "urlset"
          : "none";
    if (kind === "none") return { kind, locs: [], total: 0 };
    const locs: string[] = [];
    let total = 0;
    for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]{0,2000}?)<\/loc\s*>/gi)) {
        const value = decodeEntities(
            (match[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        ).trim();
        if (!/^https?:\/\//i.test(value)) continue;
        total += 1;
        if (locs.length < cap) locs.push(value);
    }
    return { kind, locs, total };
}
