/** Small text helpers shared by the stages. Pure. */

export function wordCount(text: string | null | undefined): number {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
}

/** "Organizational Capacity & Experience" → "organizational-capacity-experience". */
export function slugKey(text: string, max = 48): string {
    const slug = text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, max)
        .replace(/-$/, "");
    return slug || "section";
}

const STOPWORDS = new Set(
    "a an and are as at be but by for from how in is it of on or that the this to was what when where which who will with your our you we they their its describe please provide explain include".split(
        " "
    )
);

/** "finances" → "finance", "delivered" → "deliver", "programs" → "program"; short words are left alone. */
function stem(word: string): string {
    let w = word;
    if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 5 && w.endsWith("ed")) w = w.slice(0, -2);
    return w;
}

/** Lower-cased content words, lightly stemmed. */
export function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .map(stem)
        .filter(w => w.length > 2);
}

/** Jaccard overlap of content words; 0 when either side is empty. */
export function similarity(a: string, b: string): number {
    const left = new Set(tokens(a));
    const right = new Set(tokens(b));
    if (left.size === 0 || right.size === 0) return 0;
    let shared = 0;
    for (const w of left) if (right.has(w)) shared++;
    return shared / (left.size + right.size - shared);
}

/** Trimmed text, or null when there is nothing in it. */
export function blankToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** ISO day for a date, in UTC. */
export function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** Whole days from `now` to an ISO day; negative when past; null when unparseable. */
export function daysUntil(day: string | null | undefined, now: Date): number | null {
    if (!day) return null;
    const target = new Date(`${day.slice(0, 10)}T00:00:00Z`).getTime();
    if (Number.isNaN(target)) return null;
    const today = new Date(`${isoDay(now)}T00:00:00Z`).getTime();
    return Math.round((target - today) / 86_400_000);
}
