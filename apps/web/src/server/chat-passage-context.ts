/**
 * A passage the reader selected, turned into what one chat turn needs: a
 * search query, the indexed text around the passage, and a prompt block.
 *
 * The question says what the reader wants; the passage says what they are
 * looking at. Searching on the passage mostly re-finds the passage, so the
 * search runs on the question — unless the question is only "explain this",
 * in which case the passage is all there is to search on. The surrounding
 * text comes from the document's own index (its current version), found by
 * matching the passage against the stored context chunks.
 *
 * Everything here except `locatePassageContext`'s default loader is pure.
 */

import { and, eq, inArray } from "drizzle-orm";

import { document, documentContextChunks } from "@launchstack/store/schema";
import type { ChatPassagePayload } from "~/lib/chat-passages";
import { db } from "~/server/db";

/** A question with fewer content words than this is "bare": search on the passage too. */
const MIN_CONTENT_WORDS = 3;
/** How much passage text a bare question's search query may carry. */
const QUERY_PASSAGE_CHARS = 2_000;
/** The most chunks one unbounded (page-less) anchor scan reads. */
const MAX_SCAN_ROWS = 2_000;
/** Surrounding text shown per passage, centred on the passage. */
const SURROUNDING_CHARS = 3_000;
/** Below this many normalized characters a passage is too short to anchor. */
const MIN_MATCH_CHARS = 4;
/** A passage this short that occurs in several chunks is ambiguous without a page. */
const AMBIGUOUS_MATCH_CHARS = 40;
/** A passage must be at least this long to be matched as spanning chunks. */
const MIN_SPAN_CHARS = 48;
/**
 * Normalized characters (about five words) of a spanning passage's head that
 * the first chunk, and of its tail that the last chunk, must hold.
 */
const SPAN_PROBE_CHARS = 24;
/** A spanning passage covers at most this many consecutive chunks. */
const MAX_SPAN_CHUNKS = 3;
/** Share of the passage's words a chunk must contain to be a fuzzy anchor. */
const MIN_TOKEN_OVERLAP = 0.6;
/** Retrieved text shorter than this is never dropped as already covered. */
const MIN_COVERED_CHARS = 20;

const INTRO =
    "The user selected the following passage(s) and is asking about them. Treat the selected passage as the focus of the question; use the surrounding text and the other document content for context.";

/**
 * Words that say "this thing I selected" or hold a sentence together, but
 * carry nothing to search on. A question made only of these is bare.
 */
const STOPWORDS = new Set(
    (
        "this that these those it its passage passages text section paragraph sentence part " +
        "quote quoted excerpt selection selected line lines here there above below following " +
        "explain explanation summarize summarise summary mean means meaning meant " +
        "what why how who whom which when where does do did doing done is are was were be " +
        "been being am the a an of in on at to for from by with about as into me my i we us " +
        "our you your please can could would should will shall may might must tell give show " +
        "say says said let help simple simply terms plain word words more detail details " +
        "detailed briefly short again so and or but if then than just also really very some " +
        "any all not no yes ok okay thanks thank elaborate clarify describe interpret rephrase " +
        "paraphrase break down"
    ).split(" ")
);

/**
 * The machine link Ask AI appended after a pasted passage before passages
 * travelled beside the question. Only this marker identifies Ask AI context:
 * "Quote in reply" writes `[Source message](#chat-message-…)`, and its quote
 * is part of what the person is asking about, so it is left alone.
 */
const QUOTED_CONTEXT_MARKER = "[Quoted context](#launchstack-quoted-context)";

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

export interface PassageAnchor {
    documentId: number;
    chunkId: number;
    page: number | null;
    content: string;
}

/** One indexed chunk as the anchor matcher reads it. */
export interface AnchorRow {
    id: number;
    content: string;
    pageNumber: number | null;
}

export type AnchorRowLoader = (query: {
    companyId: bigint;
    documentId: number;
    /** Only these pages; omitted for the bounded whole-document scan. */
    pages?: number[];
}) => Promise<AnchorRow[]>;

/**
 * Split an older client's message into what was typed and what was quoted.
 *
 * Older clients pasted the Ask AI passage into the question as a blockquote
 * followed by `[Quoted context](#launchstack-quoted-context)`. Only a
 * blockquote carrying that marker is machine context; any other blockquote —
 * one the person typed, or a "Quote in reply" — stays part of the question,
 * and a message without the marker comes back unchanged.
 *
 * One pass over the lines, never a backtracking pattern over the whole
 * message: the question is caller input of up to 120,000 characters, and a
 * regex over runs of `>` lines took seconds of CPU on a crafted message.
 */
export function splitLegacyQuote(question: string): { question: string; quoted: string[] } {
    if (!question.includes(QUOTED_CONTEXT_MARKER)) return { question, quoted: [] };
    const quoted: string[] = [];
    const kept: string[] = [];
    let block: string[] = [];
    let blanks: string[] = [];
    // Line by line, not spread: a message can hold ~120,000 lines, and
    // spreading that many arguments overflows the call stack.
    const release = () => {
        for (const line of block) kept.push(line);
        for (const line of blanks) kept.push(line);
        block = [];
        blanks = [];
    };
    for (const line of question.split("\n")) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith(">")) {
            if (blanks.length > 0) release();
            block.push(line);
        } else if (block.length > 0 && trimmed === "") {
            blanks.push(line);
        } else if (block.length > 0 && trimmed.startsWith(QUOTED_CONTEXT_MARKER)) {
            const text = block
                .map(quoteLine =>
                    quoteLine
                        .trimStart()
                        .slice(1)
                        .replace(/^[ \t]/, "")
                )
                .join("\n")
                .trim();
            if (text) quoted.push(text);
            block = [];
            blanks = [];
            const rest = trimmed.slice(QUOTED_CONTEXT_MARKER.length);
            kept.push(rest.trim() ? rest : "");
        } else {
            release();
            kept.push(line);
        }
    }
    release();
    const typed = kept
        .join("\n")
        .split(QUOTED_CONTEXT_MARKER)
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return { question: typed, quoted };
}

/** Words in `text` that are worth searching on. */
export function contentWordCount(text: string): number {
    const words = text.normalize("NFKC").toLowerCase().split(NOT_ALPHANUMERIC);
    return words.filter(word => (word.length > 1 || /\d/.test(word)) && !STOPWORDS.has(word))
        .length;
}

/**
 * What to search the index with for this turn.
 *
 * A question with something to search on is searched as typed: the passage
 * is already in the prompt, and searching on it would mostly re-find it. A
 * bare question ("Explain this passage.", "why?") carries nothing, so the
 * passage text joins it. Legacy blockquote context is stripped from the
 * question and, when no structured passage was sent, stands in for one.
 */
export function retrievalQueryFor(
    question: string,
    passages: readonly Pick<ChatPassagePayload, "text">[]
): string {
    const legacy = splitLegacyQuote(question);
    const texts = passages.length > 0 ? passages.map(passage => passage.text) : legacy.quoted;
    if (texts.length === 0) return legacy.question || question;
    if (contentWordCount(legacy.question) >= MIN_CONTENT_WORDS) return legacy.question;
    const passageQuery = texts.join("\n\n").slice(0, QUERY_PASSAGE_CHARS).trim();
    if (!passageQuery) return legacy.question || question;
    return legacy.question ? `${legacy.question}\n\n${passageQuery}` : passageQuery;
}

/**
 * Text reduced to lowercase letters and digits: whitespace, hyphenation, soft
 * hyphens, accents, ligatures, quotes and Markdown punctuation all drop out,
 * so a PDF text-layer selection matches the indexer's extraction of it.
 */
export function normalizeForMatch(text: string): string {
    return text.normalize("NFKD").toLowerCase().replace(NOT_ALPHANUMERIC, "");
}

/** `normalizeForMatch`, keeping each normalized character's offset in `text`. */
function normalizeWithOffsets(text: string): { normalized: string; offsets: number[] } {
    let normalized = "";
    const offsets: number[] = [];
    let offset = 0;
    for (const char of text) {
        for (const folded of char.normalize("NFKD").toLowerCase()) {
            if (!ALPHANUMERIC.test(folded)) continue;
            normalized += folded;
            offsets.push(offset);
        }
        offset += char.length;
    }
    return { normalized, offsets };
}

function matchTokens(text: string): Set<string> {
    return new Set(
        text
            .normalize("NFKD")
            .toLowerCase()
            .split(NOT_ALPHANUMERIC)
            .filter(word => word.length >= 3)
    );
}

function spanProbes(needle: string): { head: string; tail: string } | null {
    if (needle.length < MIN_SPAN_CHARS) return null;
    return { head: needle.slice(0, SPAN_PROBE_CHARS), tail: needle.slice(-SPAN_PROBE_CHARS) };
}

/** Length of the longest prefix of `text` that occurs in `haystack`. */
function longestPrefixIn(haystack: string, text: string): number {
    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (haystack.includes(text.slice(0, mid))) low = mid;
        else high = mid - 1;
    }
    return low;
}

/**
 * The run of consecutive chunks, starting at `start`, that together hold the
 * whole passage: each chunk takes the longest next piece of it, and the run
 * may not exceed `MAX_SPAN_CHUNKS`. Chunk overlap is harmless, since each
 * piece only has to occur somewhere in its chunk.
 */
function spanFrom(haystacks: readonly string[], start: number, needle: string): number | null {
    let covered = 0;
    const last = Math.min(haystacks.length - 1, start + MAX_SPAN_CHUNKS - 1);
    for (let index = start; index <= last; index += 1) {
        const piece = longestPrefixIn(haystacks[index]!, needle.slice(covered));
        if (piece === 0) return null;
        covered += piece;
        if (covered === needle.length) return index > start ? index : null;
    }
    return null;
}

/**
 * The chunk(s) that hold a passage, in document order.
 *
 * 1. The whole passage inside one chunk (preferring the passage's page).
 * 2. A passage that runs across chunk boundaries: consecutive chunks that
 *    hold it piece by piece, starting with a chunk that holds its head.
 * 3. Otherwise the chunk containing the largest share of the passage's
 *    words, when that share is high enough. Else nothing.
 *
 * `rows` must be in document order (chunk id order).
 */
export function pickAnchorChunks(
    passageText: string,
    rows: readonly AnchorRow[],
    page?: number
): AnchorRow[] {
    const needle = normalizeForMatch(passageText);
    if (needle.length < MIN_MATCH_CHARS || rows.length === 0) return [];
    const haystacks = rows.map(row => normalizeForMatch(row.content));
    const onPage = (index: number) => page !== undefined && rows[index]?.pageNumber === page;

    const containing = haystacks.flatMap((haystack, index) =>
        haystack.includes(needle) ? [index] : []
    );
    if (containing.length === 1) return [rows[containing[0]!]!];
    if (containing.length > 1) {
        const preferred = containing.find(onPage);
        if (preferred !== undefined) return [rows[preferred]!];
        // A short phrase found in several places is a guess, not an anchor.
        return needle.length < AMBIGUOUS_MATCH_CHARS ? [] : [rows[containing[0]!]!];
    }

    const probes = spanProbes(needle);
    if (probes) {
        const spans: [number, number][] = [];
        haystacks.forEach((haystack, start) => {
            if (!haystack.includes(probes.head)) return;
            const end = spanFrom(haystacks, start, needle);
            if (end !== null) spans.push([start, end]);
        });
        const span =
            spans.find(([start, end]) => {
                for (let index = start; index <= end; index += 1) if (onPage(index)) return true;
                return false;
            }) ?? spans[0];
        if (span) return rows.slice(span[0], span[1] + 1);
    }

    const wanted = matchTokens(passageText);
    if (wanted.size < 4) return [];
    let best = -1;
    let bestScore = 0;
    rows.forEach((row, index) => {
        const have = matchTokens(row.content);
        let shared = 0;
        for (const word of wanted) if (have.has(word)) shared += 1;
        const score = shared / wanted.size;
        if (
            score > bestScore ||
            (score === bestScore && best >= 0 && onPage(index) && !onPage(best))
        ) {
            best = index;
            bestScore = score;
        }
    });
    return best >= 0 && bestScore >= MIN_TOKEN_OVERLAP ? [rows[best]!] : [];
}

/**
 * The document's current-version context chunks, in document order. The join
 * to `document` and `version_id = current_version_id` is the same rule every
 * retrieval leg applies, so an anchor never comes from a superseded version.
 */
const loadCurrentVersionChunks: AnchorRowLoader = async ({ companyId, documentId, pages }) => {
    const rows = await db
        .select({
            id: documentContextChunks.id,
            content: documentContextChunks.content,
            pageNumber: documentContextChunks.pageNumber,
        })
        .from(documentContextChunks)
        .innerJoin(document, eq(documentContextChunks.documentId, document.id))
        .where(
            and(
                eq(documentContextChunks.documentId, BigInt(documentId)),
                eq(document.companyId, companyId),
                eq(documentContextChunks.versionId, document.currentVersionId),
                pages ? inArray(documentContextChunks.pageNumber, pages) : undefined
            )
        )
        .orderBy(documentContextChunks.id)
        .limit(MAX_SCAN_ROWS);
    return rows.map(row => ({
        id: Number(row.id),
        content: row.content,
        pageNumber: row.pageNumber ?? null,
    }));
};

/**
 * Find the indexed chunk(s) a passage came from. With a page, only that page
 * and its neighbours are read; if that misses (page numbering differs, or the
 * passage was indexed elsewhere), one bounded scan of the whole document
 * follows. The caller must already have authorized `passage.documentId`.
 * A lookup failure never fails the turn: the passage simply has no anchor.
 */
export async function locatePassageContext(
    passage: ChatPassagePayload,
    options: { companyId: bigint; load?: AnchorRowLoader }
): Promise<PassageAnchor[]> {
    const { documentId, page } = passage;
    if (documentId === undefined) return [];
    const load = options.load ?? loadCurrentVersionChunks;
    const anchor = (rows: AnchorRow[]): PassageAnchor[] =>
        pickAnchorChunks(passage.text, rows, page).map(row => ({
            documentId,
            chunkId: row.id,
            page: row.pageNumber,
            content: row.content,
        }));
    try {
        if (page !== undefined) {
            const pages = [page - 1, page, page + 1].filter(value => value > 0);
            const near = anchor(await load({ companyId: options.companyId, documentId, pages }));
            if (near.length > 0) return near;
        }
        return anchor(await load({ companyId: options.companyId, documentId }));
    } catch (error) {
        console.warn("[AIChat] could not locate a selected passage in its document:", error);
        return [];
    }
}

/** Where a passage sits in `content`, as offsets into `content`; null when not found. */
function passageSpan(content: string, passageText: string): { start: number; end: number } | null {
    const needle = normalizeWithOffsets(passageText).normalized;
    if (!needle) return null;
    const { normalized, offsets } = normalizeWithOffsets(content);
    const at = normalized.indexOf(needle);
    if (at >= 0) return { start: offsets[at]!, end: offsets[at + needle.length - 1]! + 1 };
    const probes = spanProbes(needle);
    if (!probes) return null;
    // The passage runs out of this chunk: it starts here and continues past the end…
    const head = normalized.indexOf(probes.head);
    if (head >= 0) return { start: offsets[head]!, end: content.length };
    // …or it started before this chunk and ends here.
    const tail = normalized.lastIndexOf(probes.tail);
    if (tail >= 0) return { start: 0, end: offsets[tail + probes.tail.length - 1]! + 1 };
    return null;
}

/**
 * At most `maxChars` of `content`, centred on the passage, cut at word
 * boundaries and marked with an ellipsis where text was dropped.
 */
export function excerptAround(content: string, passageText: string, maxChars = SURROUNDING_CHARS) {
    const text = content.trim();
    if (text.length <= maxChars) return text;
    const span = passageSpan(text, passageText);
    let from = 0;
    if (span) {
        const centre = Math.floor((span.start + span.end) / 2);
        from =
            span.end - span.start >= maxChars
                ? span.start
                : Math.max(0, Math.min(centre - Math.floor(maxChars / 2), text.length - maxChars));
    }
    let to = Math.min(text.length, from + maxChars);
    if (from > 0) {
        const space = text.indexOf(" ", from);
        if (space >= 0 && space - from < 40) from = space + 1;
    }
    if (to < text.length) {
        const space = text.lastIndexOf(" ", to);
        if (space > from && to - space < 40) to = space;
    }
    return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

function pagesLabel(anchors: readonly PassageAnchor[]): string {
    const pages = Array.from(
        new Set(anchors.flatMap(anchor => (anchor.page ? [anchor.page] : [])))
    ).sort((a, b) => a - b);
    if (pages.length === 0) return "";
    if (pages.length === 1) return `page ${pages[0]}`;
    return `pages ${pages[0]}–${pages[pages.length - 1]}`;
}

/**
 * The prompt block for the selected passages: each passage verbatim with its
 * document and page, then the indexed text around it. `anchors[i]` belongs to
 * `passages[i]`. Anchors in `whole` are shown untrimmed — retrieval picked the
 * same chunk, which is then left out of the retrieved content instead.
 */
export function passagePromptSection(
    passages: readonly ChatPassagePayload[],
    anchors: readonly (readonly PassageAnchor[] | undefined)[] = [],
    options: { whole?: ReadonlySet<number> } = {}
): string {
    if (passages.length === 0) return "";
    const blocks = passages.map((passage, index) => {
        const where = passage.page ? `, page ${passage.page}` : "";
        const lines = [
            `Selected passage ${index + 1} — "${passage.title}"${where}:`,
            '"""',
            passage.text,
            '"""',
        ];
        const found = anchors[index] ?? [];
        if (found.length > 0) {
            const budget = Math.floor(SURROUNDING_CHARS / found.length);
            // The viewer's page is the one the reader saw. The index's page
            // can disagree (some extractors stamp page 1 on every chunk), so
            // it only labels the surrounding text when the viewer had none.
            const pages = passage.page ? "" : pagesLabel(found);
            lines.push(`Surrounding text${pages ? ` (${pages})` : ""}:`);
            lines.push(
                found
                    .map(anchor =>
                        options.whole?.has(anchor.chunkId)
                            ? anchor.content.trim()
                            : excerptAround(anchor.content, passage.text, budget)
                    )
                    .join("\n…\n")
            );
        }
        return lines.join("\n");
    });
    return `${INTRO}\n\n${blocks.join("\n\n")}`;
}

interface RetrievedChunkLike {
    pageContent: string;
    metadata?: { parentChunkId?: number; documentId?: number; source?: string } | undefined;
}

/**
 * Split retrieved chunks into those the passage section does not already
 * show, and the anchor chunks retrieval also returned (`covered`). A
 * retrieved chunk is covered when it is an anchor's section (same context
 * chunk) or its text lies inside an anchor. Company facts are never covered:
 * they are statements, not passages.
 */
export function withoutAnchoredChunks<T extends RetrievedChunkLike>(
    documents: readonly T[],
    anchors: readonly PassageAnchor[]
): { remaining: T[]; covered: Set<number> } {
    const covered = new Set<number>();
    if (anchors.length === 0) return { remaining: [...documents], covered };
    const anchorTexts = anchors.map(anchor => normalizeForMatch(anchor.content));
    const remaining = documents.filter(doc => {
        if (doc.metadata?.source === "company_fact") return true;
        const parent = doc.metadata?.parentChunkId;
        const docId = doc.metadata?.documentId;
        let hit = anchors.findIndex(
            anchor =>
                parent !== undefined &&
                Number(parent) === anchor.chunkId &&
                (docId === undefined || Number(docId) === anchor.documentId)
        );
        if (hit < 0) {
            const text = normalizeForMatch(doc.pageContent);
            if (text.length >= MIN_COVERED_CHARS)
                hit = anchorTexts.findIndex(anchorText => anchorText.includes(text));
        }
        if (hit < 0) return true;
        covered.add(anchors[hit]!.chunkId);
        return false;
    });
    return { remaining, covered };
}
