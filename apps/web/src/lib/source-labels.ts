/**
 * Source ids in Ask answers.
 *
 * The model sees every source as `"Title" (d12)` — the document id the
 * source tools and the attached-file list share — and cites one by writing
 * its id in square brackets after the fact it supports: "Rafael Chen [d12]".
 * The server reads the ids to build the source list under the answer and
 * removes them from the saved text; the client hides them while the answer
 * is still streaming.
 *
 * Models write citations loosely, so the forms they actually produce are all
 * read and removed: lists (`[d3, d12]`), a bare `(d12)` copied from a tool
 * result, and ranges (`[d3-d9]`, `[d3]–[d9]`), which a caller that knows
 * which sources were shown can expand to those in between.
 */

const ID = String.raw`[dD]\d{1,12}`;
/** One id, or a range of them: `d12`, `d3-d9`, `d3–d9`. */
const ITEM = String.raw`${ID}(?:\s*[-–—]\s*[dD]?\d{1,12})?`;
const LIST = String.raw`${ITEM}(?:\s*[,;]\s*${ITEM})*`;
/**
 * Every citation form, with the space before it: `[d3]–[d9]` (a range
 * written as two citations), `[d3, d12]`, and `(d12)` / `([d12])`.
 */
const CITATION = new RegExp(
    String.raw`[ \t]?(?:\[(${LIST})\]\s*[-–—]\s*\[(${LIST})\]|\[(${LIST})\]|\(\s*\[?(${LIST})\]?\s*\))`,
    "g"
);
/**
 * A bracket or short parenthetical that names a source id among other words:
 * `[d237, v1]`, `(also in d12)`. Read for its ids and removed, so a loosely
 * written citation never reaches the reader; a Markdown link is left alone.
 */
const LOOSE = new RegExp(
    String.raw`[ \t]?(?:\[([^\[\]\n]{0,60}?\b${ID}\b[^\[\]\n]{0,60}?)\](?!\()|\(([^()\n]{0,60}?\b${ID}\b[^()\n]{0,60}?)\))`,
    "g"
);
/** A citation cut off at the end of a streaming answer: `[d1`, `[d12, d`, `[d3-`. */
const TRAILING_PARTIAL = /[ \t]?\[(?:[dD]\d{0,12}(?:\s*[,;\-–—]\s*(?:[dD]?\d{0,12})?)*)?$/;

/** How the model names a source. */
export function sourceLabel(documentId: number): string {
    return `d${documentId}`;
}

/** The document id a label names (`d12`, `D12`, `[d12]`, or a bare `12`), or null. */
export function labelDocumentId(label: unknown): number | null {
    if (typeof label !== "string" && typeof label !== "number") return null;
    const match = /^\[?\s*[dD]?(\d{1,12})\s*\]?$/.exec(String(label).trim());
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The ids, and ranges of ids, one citation list names, in order. */
function parseList(list: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const item of list.split(/[,;]/)) {
        const [from, to] = item.split(/[-–—]/).map(labelDocumentId);
        if (from == null) continue;
        out.push([from, to ?? from]);
    }
    return out;
}

/**
 * The ids an answer cites, in order of first citation, each once. A range
 * becomes the `known` ids that fall inside it (the sources the model was
 * shown); with nothing known, only its two ends.
 */
export function citedDocumentIds(text: string, known?: Iterable<number>): number[] {
    const knownIds = known ? [...new Set(known)].sort((a, b) => a - b) : null;
    const seen = new Set<number>();
    const add = ([from, to]: [number, number]) => {
        if (from === to || !knownIds) {
            seen.add(from);
            seen.add(to);
            return;
        }
        const [low, high] = from < to ? [from, to] : [to, from];
        for (const id of knownIds) if (id >= low && id <= high) seen.add(id);
    };
    const found: Array<{ at: number; ids: Array<[number, number]> }> = [];
    for (const match of text.matchAll(CITATION)) {
        const [, joinedFrom, joinedTo, bracketed, parenthesized] = match;
        if (joinedFrom !== undefined && joinedTo !== undefined) {
            const start = parseList(joinedFrom);
            const end = parseList(joinedTo);
            // `[d3]–[d9]`: the last id before the dash to the first after it.
            const ids = start.slice(0, -1);
            if (start.length > 0 && end.length > 0) ids.push([start.at(-1)![1], end[0]![0]]);
            ids.push(...end.slice(1));
            found.push({ at: match.index, ids });
            continue;
        }
        found.push({ at: match.index, ids: parseList(bracketed ?? parenthesized ?? "") });
    }
    // Loose citations, read where the strict forms left nothing.
    const rest = text.replace(CITATION, whole => " ".repeat(whole.length));
    for (const match of rest.matchAll(LOOSE)) {
        const inside = match[1] ?? match[2] ?? "";
        const ids = [...inside.matchAll(new RegExp(ID, "g"))]
            .map(([token]) => labelDocumentId(token))
            .filter((id): id is number => id !== null)
            .map((id): [number, number] => [id, id]);
        found.push({ at: match.index, ids });
    }
    found.sort((a, b) => a.at - b.at);
    for (const { ids } of found) ids.forEach(add);
    return [...seen];
}

/** The answer without its source ids. */
export function stripSourceLabels(text: string): string {
    return text.replace(CITATION, "").replace(LOOSE, "");
}

/** A streaming answer as it should read so far: ids, and a half-written one, hidden. */
export function stripStreamingSourceLabels(text: string): string {
    return stripSourceLabels(text).replace(TRAILING_PARTIAL, "");
}
