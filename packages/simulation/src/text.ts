/**
 * Lexical interest similarity.
 *
 * OASIS ranks posts by the cosine between an embedding of the user's profile
 * and each post. This package has no model dependency, so the default is the
 * cosine between TF-IDF vectors over the posts in the world — the same shape
 * of score, computed locally. Hosts can pass an embedding-backed similarity
 * instead (see `RoundDeps.similarity`).
 */

const STOPWORDS = new Set(
    (
        "a an and are as at be been but by can could did do does for from had has have he her his " +
        "how i if in into is it its just me my no not of on or our out over so some than that the " +
        "their them then there these they this to too up us was we were what when which who why " +
        "will with would you your yours about after again all also am any because before being both " +
        "each few more most other own same she should such through under until very while"
    ).split(" ")
);

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .split(/[^\p{L}\p{N}]+/u)
        .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

export type Vector = Map<string, number>;

/** Inverse document frequency over a corpus of token lists. */
export function idf(docs: string[][]): Map<string, number> {
    const df = new Map<string, number>();
    for (const doc of docs) {
        for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = docs.length;
    const out = new Map<string, number>();
    for (const [t, d] of df) out.set(t, Math.log((n + 1) / (d + 1)) + 1);
    return out;
}

export function tfidf(tokens: string[], weights: Map<string, number>): Vector {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vector = new Map();
    for (const [t, c] of tf) v.set(t, c * (weights.get(t) ?? 1));
    return v;
}

export function cosine(a: Vector, b: Vector): number {
    if (a.size === 0 || b.size === 0) return 0;
    let dot = 0;
    const [small, large] = a.size < b.size ? [a, b] : [b, a];
    for (const [t, w] of small) {
        const o = large.get(t);
        if (o !== undefined) dot += w * o;
    }
    if (dot === 0) return 0;
    let na = 0;
    let nb = 0;
    for (const w of a.values()) na += w * w;
    for (const w of b.values()) nb += w * w;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function clip(text: string, max: number): string {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** TeX math some models write in plain prose ("Free $\\rightarrow$ Trial"), as the characters people expect. */
const TEX_SYMBOLS: Array<[RegExp, string]> = [
    [/\$?\s*\\(?:long)?rightarrow\s*\$?/g, "→"],
    [/\$?\s*\\to\s*\$/g, "→"],
    [/\$?\s*\\(?:long)?leftarrow\s*\$?/g, "←"],
    [/\$\s*\\(?:geq|ge)\s*\$/g, "≥"],
    [/\$\s*\\(?:leq|le)\s*\$/g, "≤"],
    [/\$\s*\\times\s*\$/g, "×"],
    [/\$\s*\\approx\s*\$/g, "≈"],
];

export function cleanProse(text: string): string {
    let out = text;
    for (const [pattern, symbol] of TEX_SYMBOLS) out = out.replace(pattern, ` ${symbol} `);
    return out
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([.,;:!?])/g, "$1")
        .trim();
}
