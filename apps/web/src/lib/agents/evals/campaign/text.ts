/**
 * Small deterministic text utilities for campaign assertions.
 *
 * Everything here is pure and dependency-free by design. The repo already
 * carries `string-similarity-js` (used by the grounding guardrail), so that is
 * reused for fuzzy comparison rather than adding a new similarity dependency.
 */

/** Collapse whitespace and lowercase. Safe on null/undefined. */
export function normalize(text: string | null | undefined): string {
    if (typeof text !== "string") return "";
    return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Collapse whitespace but preserve case. Used for provenance matching. */
export function collapseWhitespace(text: string | null | undefined): string {
    if (typeof text !== "string") return "";
    return text.replace(/\s+/g, " ").trim();
}

/** Word tokens, lowercased, punctuation stripped. */
export function tokenize(text: string | null | undefined): string[] {
    return normalize(text)
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

/** Jaccard similarity over unique word tokens. Returns 0..1. */
export function jaccard(a: string, b: string): number {
    const sa = new Set(tokenize(a));
    const sb = new Set(tokenize(b));
    if (sa.size === 0 && sb.size === 0) return 1;
    if (sa.size === 0 || sb.size === 0) return 0;
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    return inter / (sa.size + sb.size - inter);
}

/** First sentence (or first line) of a message — the "opening hook". */
export function openingHook(text: string | null | undefined): string {
    const t = collapseWhitespace(text);
    if (!t) return "";
    const firstLine = (typeof text === "string" ? text.split("\n") : [])
        .map(l => l.trim())
        .find(l => l.length > 0);
    const source = firstLine ?? t;
    const m = /^(.+?[.!?])(\s|$)/.exec(source);
    return normalize(m?.[1] ?? source);
}

/**
 * Count hashtags. Requires a letter directly after `#` so that `#1` and
 * markdown headings are not miscounted.
 */
export function countHashtags(text: string): number {
    return (text.match(/(^|\s)#[\p{L}][\p{L}\p{N}_]*/gu) ?? []).length;
}

const GRAPHEME_SEGMENTER: Intl.Segmenter | null =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

/** Split into user-perceived characters (grapheme clusters). */
export function graphemes(text: string): string[] {
    if (typeof text !== "string" || text.length === 0) return [];
    if (GRAPHEME_SEGMENTER) {
        return [...GRAPHEME_SEGMENTER.segment(text)].map(s => s.segment);
    }
    // Fallback: code points (still better than UTF-16 units).
    return [...text];
}

/** Length in grapheme clusters, not UTF-16 code units. "👨‍👩‍👧" counts as 1. */
export function countGraphemes(text: string): number {
    return graphemes(text).length;
}

/**
 * Count emoji as user-perceived characters: grapheme clusters containing an
 * Extended_Pictographic scalar or a regional-indicator flag pair. Text-default
 * symbols (©, ™, ↔ …) only count when explicitly emoji-styled with VS16, so a
 * plain "©" is not an emoji. A ZWJ family or a flag counts once.
 */
export function countEmojis(text: string): number {
    let count = 0;
    for (const cluster of graphemes(text)) {
        if (/\p{Regional_Indicator}/u.test(cluster)) {
            count++;
            continue;
        }
        // Emoji_Presentation = emoji-by-default scalars (🎉, 😀, …).
        if (/\p{Emoji_Presentation}/u.test(cluster)) {
            count++;
            continue;
        }
        // Text-default pictographs need an explicit VS16 to render as emoji.
        if (/\p{Extended_Pictographic}/u.test(cluster) && cluster.includes("\u{FE0F}")) {
            count++;
        }
    }
    return count;
}

/**
 * TLDs accepted for a bare domain with no path. Deliberately a short,
 * conservative list so prose like "node.js" or "See fig.1" never counts;
 * `.example` is included because all fixture companies use reserved
 * `.example` domains.
 */
const BARE_DOMAIN_TLDS =
    "com|org|net|io|co|dev|app|ai|me|us|uk|ca|au|de|fr|es|it|nl|se|example";

const EXPLICIT_URL_RE = /https?:\/\/\S+/gi;
const BARE_URL_WITH_PATH_RE = /(?<=^|\s)(?!https?:\/\/)[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/gi;
const BARE_DOMAIN_RE = new RegExp(
    // ≥2 dot-separated labels ending in a known-ish TLD at a word boundary,
    // not followed by a path (those are matched by BARE_URL_WITH_PATH_RE).
    `(?<=^|\\s)(?!https?:\\/\\/)[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${BARE_DOMAIN_TLDS})(?=$|[\\s.,;:!?)\\]"'])`,
    "gi"
);

/** All URL-ish spans in `text`: explicit links, bare domains with or without a path. */
export function extractUrls(text: string): string[] {
    if (typeof text !== "string" || text.length === 0) return [];
    const out: string[] = [];
    const seenRanges: Array<[number, number]> = [];
    const collect = (re: RegExp) => {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
            const start = m.index ?? 0;
            const end = start + m[0].length;
            // Skip spans already covered by an earlier (higher-priority) pattern.
            if (seenRanges.some(([s, e]) => start < e && end > s)) continue;
            seenRanges.push([start, end]);
            out.push(m[0]);
        }
    };
    collect(EXPLICIT_URL_RE);
    collect(BARE_URL_WITH_PATH_RE);
    collect(BARE_DOMAIN_RE);
    return out;
}

/** Count URLs: full links, bare domains with a path, and bare known-TLD domains. */
export function countUrls(text: string): number {
    return extractUrls(text).length;
}

/** Count question marks, ignoring any inside URLs (e.g. `?utm_source=`). */
export function countQuestions(text: string): number {
    let stripped = text;
    for (const url of extractUrls(text)) {
        stripped = stripped.replace(url, " ");
    }
    return (stripped.match(/\?/g) ?? []).length;
}

/**
 * Effective character length for platform limits: grapheme clusters, with each
 * detected URL weighted as 23 characters on X (t.co wrapping), per its
 * documented counting rules.
 */
export function effectiveCharLength(text: string, platform?: string): number {
    if (typeof text !== "string" || text.length === 0) return 0;
    if (platform !== "x") return countGraphemes(text);
    const urls = extractUrls(text);
    let rest = text;
    for (const url of urls) rest = rest.replace(url, "");
    return countGraphemes(rest) + 23 * urls.length;
}

/**
 * Numeric claims in the text: integers, decimals, percentages, currency and
 * ranges. Returned normalised (digits and an optional `%`) for comparison —
 * thousands separators are stripped so "4,000" and "4000" compare equal.
 */
export function extractNumerics(text: string): string[] {
    const raw = text.match(/\d[\d,.]*\s?%?/g) ?? [];
    return raw
        .map(n => n.replace(/\s/g, "").replace(/[.,]$/, "").replace(/,/g, ""))
        .filter(n => /\d/.test(n));
}

/** Does `haystack` contain `needle`, whitespace- and case-insensitively? */
export function containsNormalized(haystack: string, needle: string): boolean {
    const n = normalize(needle);
    if (!n) return false;
    return normalize(haystack).includes(n);
}

/**
 * Longest run of consecutive words shared between `text` and any `source`.
 * Used to detect verbatim copying from fixture documents.
 */
export function longestSharedWordRun(
    text: string,
    sources: string[]
): {
    length: number;
    excerpt: string;
} {
    const t = tokenize(text);
    if (t.length === 0) return { length: 0, excerpt: "" };

    let best = 0;
    let bestStart = 0;

    for (const src of sources) {
        const s = tokenize(src);
        if (s.length === 0) continue;

        // Rolling DP over one row keeps this O(t*s) time, O(s) space.
        let prev = new Array<number>(s.length + 1).fill(0);
        for (let i = 1; i <= t.length; i++) {
            const cur = new Array<number>(s.length + 1).fill(0);
            for (let j = 1; j <= s.length; j++) {
                if (t[i - 1] === s[j - 1]) {
                    cur[j] = (prev[j - 1] ?? 0) + 1;
                    if ((cur[j] ?? 0) > best) {
                        best = cur[j] ?? 0;
                        bestStart = i - best;
                    }
                }
            }
            prev = cur;
        }
    }

    return { length: best, excerpt: t.slice(bestStart, bestStart + best).join(" ") };
}

/** Superlative and absolute-claim vocabulary. */
export const SUPERLATIVE_PATTERNS: readonly RegExp[] = [
    /\bthe (?:best|fastest|easiest|most \w+|only|leading|number one|#1)\b/i,
    /\bworld[- ]class\b/i,
    /\bbest[- ]in[- ]class\b/i,
    /\bindustry[- ]leading\b/i,
    /\bunmatched\b/i,
    /\bunrivalled\b/i,
    /\bunrivaled\b/i,
    /\brevolutionary\b/i,
    /\bgame[- ]chang(?:er|ing)\b/i,
    /\bguarantee[sd]?\b/i,
    /\b100% (?:secure|reliable|accurate|compliant)\b/i,
    /\bzero (?:risk|downtime)\b/i,
    /\bnever fails?\b/i,
];

/** Return matched superlative phrases found in `text`. */
export function findSuperlatives(text: string): string[] {
    const hits: string[] = [];
    for (const re of SUPERLATIVE_PATTERNS) {
        const m = re.exec(text);
        if (m?.[0]) hits.push(m[0]);
    }
    return [...new Set(hits)];
}

/**
 * Candidate product-name-like tokens: TitleCase or CamelCase multiword spans,
 * and ALLCAPS-with-digits tokens (e.g. "NW-40"). Deliberately conservative.
 */
export function extractProductNameCandidates(text: string): string[] {
    const out = new Set<string>();
    const titleCase = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)+\b/g) ?? [];
    for (const m of titleCase) out.add(m.trim());
    const codeLike = text.match(/\b[A-Z]{2,}[- ]?\d{1,4}\b/g) ?? [];
    for (const m of codeLike) out.add(m.trim());
    return [...out];
}
