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

/** Count emoji-ish codepoints (pictographic + regional indicators). */
export function countEmojis(text: string): number {
    return [...text].filter(ch => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(ch))
        .length;
}

/** Count URLs (bare domains and full links). */
export function countUrls(text: string): number {
    const explicit = text.match(/https?:\/\/\S+/gi) ?? [];
    const bare = text.match(/(^|\s)(?!https?:\/\/)[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/gi) ?? [];
    return explicit.length + bare.length;
}

/** Count question marks. */
export function countQuestions(text: string): number {
    return (text.match(/\?/g) ?? []).length;
}

/**
 * Numeric claims in the text: integers, decimals, percentages, currency and
 * ranges. Returned normalised (digits and an optional `%`) for comparison.
 */
export function extractNumerics(text: string): string[] {
    const raw = text.match(/\d[\d,.]*\s?%?/g) ?? [];
    return raw.map(n => n.replace(/\s/g, "").replace(/[.,]$/, "")).filter(n => /\d/.test(n));
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
