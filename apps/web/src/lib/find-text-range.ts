/**
 * Locate a cited passage inside rendered DOM so viewers can highlight it.
 *
 * Retrieval snippets come from extracted chunk text: whitespace-normalized,
 * possibly carrying markdown syntax the renderer consumed (`**`, `#`, …), and
 * possibly clipped mid-sentence. The rendered DOM meanwhile drops whitespace
 * at block boundaries (line divs, paragraphs, PDF text-layer line breaks).
 * Matching therefore happens in a normalized space — lowercased, ALL
 * whitespace removed, markdown marker characters dropped — with a
 * per-character map back to the original (node, offset) so a hit converts to
 * a real DOM Range. Whitespace-free matching cannot be broken by any
 * disagreement about where lines wrap; accidental word-joins are not a
 * practical risk at citation-snippet lengths.
 */

/**
 * A "locate and highlight this cited passage" request handed to a document
 * viewer. `nonce` distinguishes repeat clicks on the same citation so the
 * viewer re-scrolls.
 */
export interface ViewerHighlight {
    /** The cited snippet — the primary text to locate. */
    text: string;
    /** Narrower match phrase to fall back to when the snippet can't be found. */
    matchText?: string;
    /** Page hint for paginated documents (1-based). */
    page?: number | null;
    nonce: number;
}

/** Characters dropped from BOTH needle and haystack before matching. */
const MARKER_CHARS = new Set(["*", "`", "_", "#", "~", "|", ">", "“", "”", "‘", "’", '"', "'"]);

interface CharMapEntry {
    node: Text;
    offset: number;
}

function isSkippableElement(el: Element): boolean {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
    // Presentational chrome (line-number gutters, highlight overlays) opts out
    // of matching via aria-hidden.
    return el.closest('[aria-hidden="true"]') !== null;
}

/** Normalize a needle the same way the haystack is normalized. */
function normalizeNeedle(raw: string): string {
    let out = "";
    let lastWasSpace = true;
    for (const ch of raw) {
        if (MARKER_CHARS.has(ch)) continue;
        if (/\s/.test(ch)) {
            if (!lastWasSpace) {
                out += " ";
                lastWasSpace = true;
            }
            continue;
        }
        const lower = ch.toLowerCase();
        out += lower.length === 1 ? lower : ch;
        lastWasSpace = false;
    }
    return out.trim();
}

/**
 * Candidate needles for a citation, strongest first. The full snippet wins
 * when the passage survived extraction verbatim; the shorter windows recover
 * when the snippet was clipped mid-word or spans markup the renderer
 * consumed asymmetrically (link URLs, table pipes).
 */
export function citationNeedles(snippet: string, matchText?: string): string[] {
    const base = normalizeNeedle(snippet).replace(/^[.…\s]+|[.…\s]+$/g, "");
    const candidates: string[] = [];
    const push = (s: string) => {
        const trimmed = s.trim();
        if (trimmed.length >= 8 && !candidates.includes(trimmed)) candidates.push(trimmed);
    };

    push(base);
    for (const len of [120, 60, 30]) {
        if (base.length > len) {
            // Cut back to a word boundary so the window never ends mid-word.
            const window = base.slice(0, len);
            const cut = window.lastIndexOf(" ");
            push(cut > len / 2 ? window.slice(0, cut) : window);
        }
    }
    if (base.length > 60) {
        const tail = base.slice(-60);
        const cut = tail.indexOf(" ");
        push(cut >= 0 && cut < 30 ? tail.slice(cut + 1) : tail);
    }
    if (matchText) push(normalizeNeedle(matchText));
    return candidates;
}

/** `root`'s visible text in the matching space, with each character's place in the DOM. */
function buildHaystack(root: Node): { doc: Document; haystack: string; map: CharMapEntry[] } {
    const doc = root.ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
            const parent = node.parentElement;
            if (parent && isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    let haystack = "";
    const map: CharMapEntry[] = [];

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const textNode = n as Text;
        const value = textNode.nodeValue ?? "";
        for (let i = 0; i < value.length; i++) {
            const ch = value[i]!;
            if (MARKER_CHARS.has(ch) || /\s/.test(ch)) continue;
            const lower = ch.toLowerCase();
            haystack += lower.length === 1 ? lower : ch;
            map.push({ node: textNode, offset: i });
        }
    }
    return { doc, haystack, map };
}

function rangeAt(doc: Document, map: CharMapEntry[], index: number, length: number): Range | null {
    const start = map[index];
    const end = map[index + length - 1];
    if (!start || !end) return null;
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
}

/**
 * Find the first candidate needle inside `root`'s visible text and return it
 * as a DOM Range, or null when nothing matches.
 */
export function findTextRange(root: Node, needles: string[]): Range | null {
    if (needles.length === 0) return null;
    const { doc, haystack, map } = buildHaystack(root);

    for (const rawNeedle of needles) {
        const needle = rawNeedle.replace(/\s+/g, "");
        if (needle.length === 0) continue;
        const idx = haystack.indexOf(needle);
        if (idx < 0) continue;
        const range = rangeAt(doc, map, idx, needle.length);
        if (range) return range;
    }
    return null;
}

/**
 * Every place `query` occurs in `root`'s visible text, in reading order and
 * not overlapping — what a viewer's Find marks. Matched like a citation:
 * case- and whitespace-insensitive, so a phrase found across a line break in
 * the page still counts. Stops at `limit` matches.
 */
export function findAllTextRanges(root: Node, query: string, limit = 1000): Range[] {
    const needle = normalizeNeedle(query).replace(/\s+/g, "");
    if (needle.length === 0 || limit <= 0) return [];
    const { doc, haystack, map } = buildHaystack(root);

    const ranges: Range[] = [];
    let from = 0;
    while (ranges.length < limit) {
        const idx = haystack.indexOf(needle, from);
        if (idx < 0) break;
        const range = rangeAt(doc, map, idx, needle.length);
        if (range) ranges.push(range);
        from = idx + needle.length;
    }
    return ranges;
}
