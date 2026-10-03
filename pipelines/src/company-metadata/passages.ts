/**
 * Company Metadata Passages — the noise filter in front of the profile model
 *
 * The company profile ("what your sources can prove") is built from a
 * workspace's stored chunks, and a stored chunk carries everything the
 * converter saw: a paper's bibliography (whose authors' cities once became
 * the company's "geography"), numeric result tables, the residue of chart
 * axes, the chunker's own overlap repeated inside a parent, page furniture,
 * and the "(untitled)" nodes of an empty mindmap. This module cleans one
 * document's chunks before any model reads them:
 *
 *   1. Drop the stored breadcrumb and a leading repeat of the title.
 *   2. Cut the chunker's overlap — a span copied from the end of the
 *      previous piece to the start of the next — at every piece boundary.
 *   3. Work line by line (lists, outlines) and sentence by sentence (prose),
 *      dropping placeholders, boilerplate, dense runs of bare numbers
 *      (tables) and axis/legend residue (figures), then bibliography entries,
 *      which are recognised as a cluster, never one keyword at a time.
 *   4. Drop a sentence the document already said, and a whole passage that
 *      repeats an earlier one.
 *   5. Keep the chunk when real text is left; otherwise report it dropped
 *      under the reason that removed most of it.
 *
 * Conservative by design: dropping a real company fact is worse than letting
 * a sentence of noise through. Every rule needs positive evidence of noise,
 * a prose sentence with an inline citation ("(Chen et al., 2023)") is left
 * alone, and a short factual line ("Founded in 2024 · Headquarters:
 * Baltimore, MD") is never judged on its own length.
 *
 * Also home to the grounding gate: {@link quoteAppearsIn} accepts a model's
 * quote only when it appears verbatim in the passage once both sides are
 * normalised the same way ({@link normalizeForMatch}).
 *
 * Pure: no I/O, no model calls.
 */

import { stripStoredContextHeader } from "@launchstack/conversion/ocr/chunker";

// ============================================================================
// Public shapes
// ============================================================================

export interface RawChunk {
    id: number;
    content: string;
    page: number | null;
    semanticType?: string | null;
}

export interface Passage {
    chunkId: number;
    page: number | null;
    text: string;
}

export const DROP_REASONS = [
    "references",
    "table",
    "figure",
    "boilerplate",
    "placeholder",
    "too_short",
    "duplicate",
] as const;

export type DropReason = (typeof DROP_REASONS)[number];

export interface CleanResult {
    passages: Passage[];
    total: number;
    kept: number;
    /** Whole chunks dropped, by reason. A chunk that keeps any text is kept. */
    dropped: Record<DropReason, number>;
}

/** One chunk's outcome, for diagnostics and evidence reports. */
export interface ChunkVerdict {
    chunkId: number;
    /** The passage handed to the model; null when the chunk was dropped. */
    passage: Passage | null;
    /** Why the chunk was dropped; null when it was kept. */
    reason: DropReason | null;
    /** Non-space characters removed from this chunk, by reason (kept chunks too). */
    removed: Record<DropReason, number>;
}

// ============================================================================
// Thresholds
// ============================================================================

/** Below this many letters a passage says nothing a model could quote. */
const MIN_LETTERS = 40;
/**
 * A passage under this many letters is also too thin when it is under
 * {@link THIN_SHARE} of what the chunk held: a caption fragment left over
 * from a table is not a passage.
 */
const THIN_LETTERS = 120;
const THIN_SHARE = 0.25;
/**
 * A passage that is only a "Table 3: …" / "Figure 4: …" caption, once its
 * table or chart was removed, describes something the model will never see.
 * Longer than this, it is prose that happens to open with a caption.
 */
const CAPTION_ONLY_MAX_LETTERS = 500;
const CAPTION = /^(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*[:.]/;

/** A repeated span shorter than this is a coincidence, not the chunker's overlap. */
const REPEAT_MIN_WORDS = 12;
const REPEAT_MIN_CHARS = 60;
/** How far back the overlap can start (the chunker's default is ~200 chars). */
const REPEAT_WINDOW = 2000;
const REPEAT_PROBE = 24;

/** A run of numbers is a table or chart only when it is long and dense. */
const RUN_MIN_NUMBERS = 6;
const RUN_MIN_BARE_NUMBERS = 3;
const RUN_MIN_DENSITY = 0.6;
const LABELLED_RUN_MIN_DENSITY = 0.8;
/** Words allowed between two numbers of one run (a row label). */
const RUN_MAX_GAP = 3;
/** Stop words allowed inside a run, as a share of its tokens. */
const RUN_MAX_STOP_SHARE = 0.15;
/** Label words a run may absorb on either side ("Contriever GTR", "Recall (%)"). */
const LABEL_MAX_WORDS = 6;
/** A stop-word-free sentence this short next to a table is its header row. */
const LABEL_SENTENCE_MAX_TOKENS = 12;
/** A stop-word-free token soup this long, with repeats or symbols, is a diagram's labels. */
const LABEL_SOUP_MIN_TOKENS = 10;

/**
 * A chunk with a line this long is flowed text (a PDF's pieces), where a
 * small number at the end of a line is the page number the converter kept.
 */
const FLOWED_LINE_MIN_CHARS = 300;

/** Shortest quote the grounding gate will accept as evidence. */
const MIN_QUOTE_CHARS = 12;

// ============================================================================
// Entry points
// ============================================================================

/** Clean every chunk of one document version, in order. Pure. */
export function cleanPassages(chunks: RawChunk[], options: { title: string }): CleanResult {
    const dropped = emptyCounts();
    const passages: Passage[] = [];
    for (const verdict of explainPassages(chunks, options)) {
        if (verdict.passage) passages.push(verdict.passage);
        else if (verdict.reason) dropped[verdict.reason] += 1;
    }
    return { passages, total: chunks.length, kept: passages.length, dropped };
}

/**
 * The same cleaning, reporting every chunk's outcome — what was kept, why a
 * chunk went, and how much each rule removed. {@link cleanPassages} is this
 * with the verdicts folded into counts.
 */
export function explainPassages(chunks: RawChunk[], options: { title: string }): ChunkVerdict[] {
    const doc: DocState = {
        titleKeys: titleKeys(options.title),
        previousBody: "",
        seenSentences: new Set(),
        seenPassages: new Set(),
    };
    return chunks.map(chunk => judgeChunk(chunk, doc));
}

/**
 * Inline Markdown out, words kept: `**bold**`, `` `code` ``, `[text](url)`,
 * `![alt](src)`, heading hashes. A model quoting a README copies the words,
 * not the asterisks around them, and the person reading the excerpt wants
 * the words too.
 */
export function stripInlineMarkdown(text: string): string {
    return text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/<\/?(?:br|b|i|em|strong|code|sup|sub)\s*\/?>/gi, "");
}

/** Whitespace/hyphenation/quote-mark normalisation shared by the grounding gate. */
export function normalizeForMatch(text: string): string {
    return (
        stripInlineMarkdown(text)
            .normalize("NFKC")
            // Soft hyphens and zero-width characters are invisible in the source.
            .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
            .replace(/[\u2018\u2019\u201A\u201B\u2032`\u00B4]/g, "'")
            .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
            .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
            // A word split across a line break: "doc- ument", "pre-\ntrained".
            .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
            .replace(/\s+/g, " ")
            // PDF text spaces out punctuation ("proposition , for"); a quote won't.
            .replace(/ (?=[,.;:!?)\]}])/g, "")
            .replace(/(?<=[([{]) /g, "")
            .trim()
            .toLowerCase()
    );
}

/** True when `quote` (≥ 12 normalised chars) appears verbatim in `text` after normalising both. */
export function quoteAppearsIn(quote: string, text: string): boolean {
    const needle = normalizeForMatch(quote)
        .replace(/^["'\s]+|["'\s]+$/g, "")
        .replace(/^(?:\.{3}|…)\s*|\s*(?:\.{3}|…)$/g, "")
        .replace(/[.,;:]+$/, "")
        .trim();
    if (needle.length < MIN_QUOTE_CHARS) return false;
    const haystack = normalizeForMatch(text);
    if (haystack.includes(needle)) return true;
    // A real hyphen that fell at a line end ("open- source") reads "open-source"
    // in the model's quote; compare once more with hyphens between letters gone.
    return dropWordHyphens(haystack).includes(dropWordHyphens(needle));
}

function dropWordHyphens(text: string): string {
    return text.replace(/(?<=\p{L})-(?=\p{L})/gu, "");
}

// ============================================================================
// One chunk
// ============================================================================

interface DocState {
    titleKeys: Set<string>;
    /** The previous chunk's body, raw — the chunker's overlap is copied from it. */
    previousBody: string;
    /** Normalised sentences (≥ 12 words) already kept in this document. */
    seenSentences: Set<string>;
    /** Normalised cleaned text of every earlier chunk. */
    seenPassages: Set<string>;
}

interface Line {
    /** Indentation and list marker, re-attached when the line is rendered. */
    prefix: string;
    sentences: Sentence[];
}

interface Sentence {
    text: string;
    /** Ranges of `text` removed as table/figure residue. */
    cuts: Array<{ start: number; end: number; reason: "table" | "figure" }>;
    reason: DropReason | null;
}

function judgeChunk(chunk: RawChunk, doc: DocState): ChunkVerdict {
    const removed = emptyCounts();
    const body = stripInlineMarkdown(
        stripLeadingTitle(stripStoredContextHeader(chunk.content ?? ""), doc.titleKeys)
    );
    const repeats = cutRepeatedSpans(doc.previousBody, body);
    doc.previousBody = body;
    // The overlap is reported, but it says nothing about what this chunk is:
    // the copy's verdict was given in the chunk it came from.
    const overlap = repeats.removed;
    const flowed = body.split("\n").some(line => line.length >= FLOWED_LINE_MIN_CHARS);

    const lines = repeats.text.split("\n").map(raw => prepareLine(raw, flowed, removed));
    const sentences = lines.flatMap(line => line.sentences);
    markTableNeighbours(sentences, removed);
    markReferences(sentences, removed);
    const pendingKeys = markRepeatedSentences(sentences, doc.seenSentences, removed);

    const text = lines
        .map(renderLine)
        .filter(line => line.length > 0)
        .join("\n");
    const verdict = (reason: DropReason | null): ChunkVerdict => {
        const report = { ...removed, duplicate: removed.duplicate + overlap };
        return {
            chunkId: chunk.id,
            passage: reason ? null : { chunkId: chunk.id, page: chunk.page, text },
            reason,
            removed: report,
        };
    };
    const thinReason = () => {
        const reason = dominantReason(removed, nonSpace(text));
        return reason === "too_short" && overlap > nonSpace(text) ? "duplicate" : reason;
    };

    if (!text) return verdict(thinReason());

    const key = normalizeForMatch(text);
    if (doc.seenPassages.has(key)) {
        removed.duplicate += nonSpace(text);
        return verdict("duplicate");
    }
    doc.seenPassages.add(key);

    const letters = countLetters(text);
    const captionOnly =
        CAPTION.test(text) &&
        removed.table + removed.figure > 0 &&
        letters < CAPTION_ONLY_MAX_LETTERS;
    const thin =
        captionOnly ||
        letters < MIN_LETTERS ||
        (letters < THIN_LETTERS && letters < THIN_SHARE * countLetters(repeats.text));
    if (thin) return verdict(thinReason());

    for (const sentenceKey of pendingKeys) doc.seenSentences.add(sentenceKey);
    return verdict(null);
}

/**
 * The reason that removed most of a chunk — or `too_short` when the chunk was
 * simply short and the filters took less than what was left.
 */
function dominantReason(removed: Record<DropReason, number>, keptChars: number): DropReason {
    let best: DropReason = "too_short";
    let bestChars = 0;
    let total = 0;
    for (const reason of DROP_REASONS) {
        total += removed[reason];
        if (removed[reason] > bestChars) {
            best = reason;
            bestChars = removed[reason];
        }
    }
    return total > 0 && total >= keptChars ? best : "too_short";
}

function renderLine(line: Line): string {
    const body = line.sentences
        .filter(sentence => !sentence.reason)
        .map(keptText)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return body ? `${line.prefix}${body}` : "";
}

function keptText(sentence: Sentence): string {
    if (sentence.cuts.length === 0) return sentence.text;
    const parts: string[] = [];
    let at = 0;
    for (const { start, end } of sentence.cuts) {
        parts.push(sentence.text.slice(at, start));
        at = end;
    }
    parts.push(sentence.text.slice(at));
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

function drop(sentence: Sentence, reason: DropReason, removed: Record<DropReason, number>) {
    removed[reason] += nonSpace(keptText(sentence));
    sentence.reason = reason;
}

// ============================================================================
// Headers, titles, and the chunker's overlap
// ============================================================================

function titleKeys(title: string): Set<string> {
    const keys = new Set<string>();
    const key = collapse(title).toLowerCase();
    if (key) {
        keys.add(key);
        keys.add(key.replace(/\.[a-z0-9]{1,5}$/, ""));
    }
    return keys;
}

/** PDF chunks open with their file name: a header with no breadcrumb steps. */
function stripLeadingTitle(body: string, keys: Set<string>): string {
    if (keys.size === 0) return body;
    const lineEnd = body.indexOf("\n");
    const first = collapse(lineEnd === -1 ? body : body.slice(0, lineEnd)).toLowerCase();
    if (!keys.has(first)) return body;
    return lineEnd === -1 ? "" : body.slice(lineEnd + 1).replace(/^\s*\n/, "");
}

/**
 * Cut the chunker's overlap. Pieces are joined with a newline and each piece
 * opens with a copy of the previous piece's last ~50 tokens — often from the
 * middle of a word — so at every line start (and at the chunk start, against
 * the previous chunk) look for the longest prefix that is also a suffix of
 * the text before it.
 */
function cutRepeatedSpans(previous: string, body: string): { text: string; removed: number } {
    const cuts: Array<[number, number]> = [];
    let atStart = repeatLength(previous, body);
    // The previous chunk stopped mid-word ("...from the retriev"); this one
    // resumes with the rest of it ("al corpus"). Half a word is not a word.
    if (atStart > 0 && /\p{L}$/u.test(previous) && /^\p{L}/u.test(body.slice(atStart))) {
        atStart += /^\S*/.exec(body.slice(atStart))?.[0].length ?? 0;
    }
    if (atStart > 0) cuts.push([0, atStart]);
    let newline = body.indexOf("\n", atStart);
    while (newline !== -1) {
        const before = body.slice(Math.max(0, newline - REPEAT_WINDOW), newline);
        const length = repeatLength(before, body.slice(newline + 1));
        // The pieces were contiguous in the source: cut the join with the copy,
        // so "...retrieval task a" + "nd downstream" reads "and" again.
        if (length > 0) cuts.push([newline, newline + 1 + length]);
        newline = body.indexOf("\n", newline + 1 + length);
    }
    if (cuts.length === 0) return { text: body, removed: 0 };

    let text = "";
    let at = 0;
    let removed = 0;
    for (const [start, end] of cuts) {
        text += body.slice(at, start);
        removed += nonSpace(body.slice(start, end));
        at = end;
    }
    text += body.slice(at);
    return { text, removed };
}

function repeatLength(before: string, after: string): number {
    if (before.length < REPEAT_PROBE || after.length < REPEAT_PROBE) return 0;
    const probe = after.slice(0, REPEAT_PROBE);
    let at = before.indexOf(probe, Math.max(0, before.length - REPEAT_WINDOW));
    while (at !== -1) {
        const tail = before.slice(at);
        // The earliest match is the longest overlap; a shorter one can't qualify.
        if (after.startsWith(tail)) {
            const words = tail.trim().split(/\s+/).length;
            return words >= REPEAT_MIN_WORDS && tail.length >= REPEAT_MIN_CHARS ? tail.length : 0;
        }
        at = before.indexOf(probe, at + 1);
    }
    return 0;
}

// ============================================================================
// Lines: markers, placeholders, boilerplate, inline furniture
// ============================================================================

const LIST_MARKER = /^(\s*)((?:[-*+•◦▪‣]|\d{1,3}[.)])(?=\s|$))?\s*/;

/** Empty mindmap nodes and editor defaults. */
const PLACEHOLDER =
    /^(?:\(\s*(?:untitled|empty|no title|blank)\s*\)|untitled(?: (?:node|topic|idea))?|new (?:node|idea|topic)|central topic|main topic(?: \d+)?|sub-?topic(?: \d+)?|floating topic|click to (?:edit|add)\b.*|type (?:something|here)|\.{3}|…|[-–—_]+)$/i;

/** Whole lines that are page furniture. */
const BOILERPLATE_LINE = [
    /^(?:page\s+)?\d{1,3}(?:\s*(?:\/|of)\s*\d{1,4})?$/i,
    /^(?:table of )?contents$/i,
    /^(?:confidential|strictly confidential|draft|internal|private (?:and|&) confidential)$/i,
    /^[-_*=]{3,}$/,
];

/** Furniture inside a line, cut without touching the text around it. */
const BOILERPLATE_INLINE = [
    // arXiv's margin stamp: "arXiv:2312.06648v3 [cs.CL] 4 Oct 2024".
    /\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\s*\[[^\]\n]{1,20}\]\s*\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/g,
    /\bpage\s+\d{1,4}\s+of\s+\d{1,4}\b/gi,
    // Table-of-contents dot leaders: "Introduction ......... 3".
    /(?:\.\s?){4,}\s*\d{1,4}\b/g,
    /…{2,}\s*\d{1,4}\b/g,
];

/** Whole sentences that are notices, not content. */
const BOILERPLATE_SENTENCE = [
    /©/,
    /\(c\)\s*(?:19|20)\d{2}/i,
    /\bcopyright\b[^.]{0,40}\b(?:19|20)\d{2}\b/i,
    /\ball rights reserved\b/i,
    /\bconfidential(?:ity)? notice\b/i,
    /\b(?:proprietary|privileged) (?:and|&) confidential\b/i,
    /\bconfidential (?:and|&) (?:proprietary|privileged)\b/i,
    /\bstrictly confidential\b/i,
    /\bfor internal use only\b/i,
    /\bdo not (?:distribute|forward|copy|reproduce)\b/i,
    /\bnot for (?:re)?distribution\b/i,
    /\bthis (?:document|e-?mail|message|presentation|deck|material)s? (?:is|are|contains?) (?:strictly )?(?:confidential|proprietary|privileged)\b/i,
];

/** A markdown table's rule row: "|---|:---:|". */
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;

function prepareLine(raw: string, flowed: boolean, removed: Record<DropReason, number>): Line {
    const marker = LIST_MARKER.exec(raw);
    const indent = marker?.[1] ?? "";
    const bullet = marker?.[2] ?? "";
    const line: Line = { prefix: bullet ? `${indent}${bullet} ` : "", sentences: [] };
    let content = raw.slice(marker?.[0].length ?? 0).trim();

    if (!content) {
        // An empty bullet is a node nobody named.
        if (bullet) removed.placeholder += nonSpace(bullet);
        return line;
    }
    if (PLACEHOLDER.test(content)) {
        removed.placeholder += nonSpace(raw);
        return line;
    }
    if (!bullet && BOILERPLATE_LINE.some(pattern => pattern.test(content))) {
        removed.boilerplate += nonSpace(content);
        return line;
    }
    if (TABLE_RULE.test(content)) {
        removed.table += nonSpace(content);
        return line;
    }

    for (const pattern of BOILERPLATE_INLINE) {
        content = content.replace(pattern, match => {
            removed.boilerplate += nonSpace(match);
            return " ";
        });
    }
    // A page number glued to the end of a flowed PDF line: "...units 1".
    if (flowed) {
        content = content.replace(/(?<=[\p{L}\p{P}])\s+\d{1,3}\s*$/u, match => {
            removed.boilerplate += nonSpace(match);
            return "";
        });
    }

    line.sentences = splitSentences(content).map(text => analyseSentence(text, removed));
    return line;
}

// ============================================================================
// Sentences
// ============================================================================

/** Words before a full stop that do not end a sentence. */
const ABBREVIATIONS = new Set([
    "al",
    "e.g",
    "i.e",
    "vs",
    "cf",
    "fig",
    "figs",
    "eq",
    "eqs",
    "no",
    "nos",
    "dr",
    "mr",
    "mrs",
    "ms",
    "prof",
    "sr",
    "jr",
    "st",
    "approx",
    "inc",
    "ltd",
    "co",
    "corp",
    "dept",
    "est",
    "avg",
]);

const SENTENCE_END = /[.!?]+["'”’)\]]*(?=\s+(?:[\p{Lu}\d•§"“‘]|\((?=\p{Lu})))/gu;

function isAbbreviation(word: string): boolean {
    const bare = word.replace(/^[("'“‘[]+/, "").replace(/\.$/, "");
    return ABBREVIATIONS.has(bare.toLowerCase()) || /^\p{Lu}\p{Ll}{0,3}$/u.test(bare);
}

function splitSentences(text: string): string[] {
    const out: string[] = [];
    let start = 0;
    for (const match of text.matchAll(SENTENCE_END)) {
        const at = match.index ?? 0;
        if (match[0].startsWith(".")) {
            const word = /(\S+)$/.exec(text.slice(start, at))?.[1] ?? "";
            const bare = word.replace(/^[("'“‘[]+/, "");
            // An initial ("Kilian Q. Weinberger"), an abbreviation, or "U.S".
            if (/^\p{Lu}$/u.test(bare)) continue;
            if (ABBREVIATIONS.has(bare.toLowerCase())) continue;
            if (/^(?:\p{L}\.)+\p{L}$/u.test(bare)) continue;
        }
        const end = at + match[0].length;
        const sentence = text.slice(start, end).trim();
        if (sentence) out.push(sentence);
        start = end;
    }
    const rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out;
}

function analyseSentence(text: string, removed: Record<DropReason, number>): Sentence {
    const sentence: Sentence = { text, cuts: [], reason: null };
    if (BOILERPLATE_SENTENCE.some(pattern => pattern.test(text))) {
        drop(sentence, "boilerplate", removed);
        return sentence;
    }

    const tokens = tokenize(text);
    const spans = withLegendBeforeCaption(tokens, residueSpans(tokens));
    if (spans.length === 0) {
        if (isDiagramLabels(tokens)) drop(sentence, "figure", removed);
        return sentence;
    }

    // What the residue leaves: if it is not prose, the sentence was residue.
    const inSpan = new Set<number>();
    for (const span of spans) for (let i = span.from; i <= span.to; i++) inSpan.add(i);
    const rest = tokens.filter((_, i) => !inSpan.has(i));
    const restWords = rest.filter(t => t.kind === "word" || t.kind === "stop");
    if (restWords.length < 4 || !rest.some(t => t.kind === "stop")) {
        const reason = majorityReason(spans, tokens);
        drop(sentence, reason, removed);
        return sentence;
    }
    for (const span of spans) {
        const start = tokens[span.from]?.start ?? 0;
        const end = tokens[span.to]?.end ?? start;
        removed[span.reason] += nonSpace(text.slice(start, end));
        sentence.cuts.push({ start, end, reason: span.reason });
    }
    return sentence;
}

// ============================================================================
// Tables and figures
// ============================================================================

type TokenKind = "num" | "numish" | "stop" | "word" | "symbol";

interface Token {
    text: string;
    start: number;
    end: number;
    kind: TokenKind;
}

const STOPWORDS = new Set([
    "a",
    "an",
    "the",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "by",
    "with",
    "as",
    "and",
    "or",
    "but",
    "nor",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "am",
    "has",
    "have",
    "had",
    "do",
    "does",
    "did",
    "not",
    "no",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "which",
    "who",
    "whom",
    "whose",
    "what",
    "when",
    "where",
    "why",
    "how",
    "we",
    "our",
    "us",
    "you",
    "your",
    "they",
    "their",
    "them",
    "he",
    "she",
    "his",
    "her",
    "i",
    "my",
    "me",
    "than",
    "then",
    "so",
    "if",
    "can",
    "could",
    "will",
    "would",
    "should",
    "may",
    "might",
    "must",
    "into",
    "onto",
    "over",
    "under",
    "about",
    "per",
    "via",
    "each",
    "all",
    "any",
    "both",
    "more",
    "most",
    "such",
    "only",
    "also",
    "there",
    "here",
]);

/** Chart axis and legend words. */
const AXIS_WORD =
    /^(?:#?words?|recall(?:@\S*)?|precision(?:@\S*)?|accuracy|acc|frequency|freq|epochs?|steps?|iterations?|loss|f1|score|count|latency|throughput|ndcg(?:@\S*)?|mrr|bleu|rouge\S*|perplexity|ppl|em@\S+|%|\(%\))$/i;

function tokenize(text: string): Token[] {
    const phones = phoneRanges(text);
    const tokens: Token[] = [];
    for (const match of text.matchAll(/\S+/g)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const inPhone = phones.some(([from, to]) => start >= from && end <= to);
        tokens.push({ text: match[0], start, end, kind: inPhone ? "word" : kindOf(match[0]) });
    }
    return tokens;
}

/**
 * Phone and fax numbers are digit groups too ("+1 410 555 0100"), and they
 * are exactly the contact facts a profile wants. Where the sentence says it
 * is giving a number, those groups are words, never a table.
 */
const CONTACT_CUE = /\b(?:tel|telephone|phone|fax|call|mobile|cell)\b|\+\d/i;
const PHONE_NUMBER = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?(?:[\s.-]\d{2,4}){2,4}/g;

function phoneRanges(text: string): Array<[number, number]> {
    if (!CONTACT_CUE.test(text)) return [];
    return [...text.matchAll(PHONE_NUMBER)].map(match => {
        const start = match.index ?? 0;
        return [start, start + match[0].length];
    });
}

function kindOf(raw: string): TokenKind {
    const bare = raw.replace(/^[([{]+/, "").replace(/[)\]},;:.]+$/, "");
    if (/\d/.test(bare) && /^[-+±−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/.test(bare)) {
        return "num";
    }
    if (/^\d+\/\d+$/.test(bare)) return "num";
    const letters = raw.match(/\p{L}/gu)?.length ?? 0;
    // "R@5", "top-20", "Q3", "2023a" — numbers wearing a label. Currency is prose.
    if (/\d/.test(raw) && letters <= 3 && raw.length <= 12 && !/[$€£¥]/.test(raw)) return "numish";
    if (letters === 0) return "symbol";
    if (STOPWORDS.has(raw.toLowerCase().replace(/[^\p{L}']/gu, ""))) return "stop";
    return "word";
}

const isNumeric = (token: Token | undefined) => token?.kind === "num" || token?.kind === "numish";

/** "Figure 3:", "Table 1:" — a caption starts here; residue stops before it. */
function isCaptionStart(tokens: Token[], i: number): boolean {
    const word = tokens[i]?.text.replace(/[.:]$/, "");
    if (word !== "Figure" && word !== "Fig" && word !== "Table") return false;
    // "Table 3:" captions; "Table 3 shows…" is prose.
    return /^\d+[a-z]?[:.]$/.test(tokens[i + 1]?.text ?? "");
}

interface ResidueSpan {
    from: number;
    to: number;
    reason: "table" | "figure";
}

/**
 * Token ranges that are a table's rows or a chart's axes: a long, dense run
 * of numbers with few stop words, widened over the row and legend labels
 * around it. A sentence that merely quotes a few figures is never a run.
 */
function residueSpans(tokens: Token[]): ResidueSpan[] {
    const clusters: number[][] = [];
    let barrier = -1;
    tokens.forEach((token, i) => {
        // "Table 2:" opens a caption; its number belongs to no run.
        if (isCaptionStart(tokens, i)) barrier = i + 1;
        if (i <= barrier || !isNumeric(token)) return;
        const last = clusters[clusters.length - 1];
        const previous = last?.[last.length - 1];
        const joins =
            previous !== undefined && i - previous - 1 <= RUN_MAX_GAP && previous > barrier;
        if (last && joins) last.push(i);
        else clusters.push([i]);
    });

    const runs: Array<{ from: number; to: number }> = [];
    for (const cluster of clusters) {
        const from = cluster[0];
        const to = cluster[cluster.length - 1];
        if (from === undefined || to === undefined) continue;
        if (!isDenseRun(tokens, cluster, from, to)) continue;
        const last = runs[runs.length - 1];
        // Two runs separated only by a short label ("Recall (%) GTR / NQ") are one.
        if (last && isLabelGap(tokens, last.to + 1, from - 1)) last.to = to;
        else runs.push({ from, to });
    }

    return runs.map(run => {
        let { from, to } = run;
        let words = 0;
        while (from > 0 && words < LABEL_MAX_WORDS) {
            const token = tokens[from - 1];
            if (!token || token.kind === "stop" || isCaptionStart(tokens, from - 1)) break;
            // A full stop inside a sentence is either an abbreviation ("Avg.",
            // part of the header) or a clause end the splitter missed, where
            // the table stops.
            if (/[?!:]$/.test(token.text) && !isNumeric(token)) break;
            if (token.text.endsWith(".") && !isNumeric(token) && !isAbbreviation(token.text)) {
                break;
            }
            if (token.kind === "word") words++;
            from--;
        }
        words = 0;
        while (to < tokens.length - 1 && words < LABEL_MAX_WORDS) {
            const token = tokens[to + 1];
            if (!token || token.kind === "stop" || isCaptionStart(tokens, to + 1)) break;
            if (token.kind === "word") words++;
            to++;
            if (/[.?!]$/.test(token.text)) break;
        }
        // Nothing but labels between the run and the sentence edge: a header
        // row ("Retriever Granularity NQ TQA …") belongs to its table.
        if (isLabelRun(tokens, 0, from - 1)) from = 0;
        if (isLabelRun(tokens, to + 1, tokens.length - 1)) to = tokens.length - 1;
        return { from, to, reason: residueKind(tokens.slice(from, to + 1)) };
    });
}

/**
 * The legend a chart leaves just before its caption: "Query Corpus Passages
 * Retriever A Figure 2: We discover…". Stop-word-free words that open the
 * sentence and run into a caption go with the figure (or table) they label.
 */
function withLegendBeforeCaption(tokens: Token[], spans: ResidueSpan[]): ResidueSpan[] {
    const caption = tokens.findIndex((_, i) => i > 0 && isCaptionStart(tokens, i));
    if (caption <= 1) return spans;
    if (spans.some(span => span.from <= caption - 1 && span.to >= caption - 1)) return spans;
    const prefix = tokens.slice(0, caption);
    // A lone capital is a panel label ("Retriever A"), not the article "a".
    const isStop = (t: Token) => t.kind === "stop" && !/^\p{Lu}$/u.test(t.text);
    if (prefix.some(t => isStop(t) || /[.?!:,;]$/.test(t.text))) return spans;
    const reason = tokens[caption]?.text.startsWith("Table") ? "table" : "figure";
    // Spans inside the legend are absorbed by it.
    return [{ from: 0, to: caption - 1, reason }, ...spans.filter(span => span.to >= caption)];
}

function isDenseRun(tokens: Token[], cluster: number[], from: number, to: number): boolean {
    if (cluster.length < RUN_MIN_NUMBERS) return false;
    const span = tokens.slice(from, to + 1).filter(t => t.kind !== "symbol");
    const density = cluster.length / span.length;
    // "10, 20, 50, 100, 250, 500 and 1000 seats" is a list in a sentence;
    // table cells and axis ticks are not comma-separated.
    const listed = cluster.filter(i => /[,;]$/.test(tokens[i]?.text ?? "")).length;
    if (listed * 2 >= cluster.length) return false;
    const bare = cluster.filter(i => tokens[i]?.kind === "num").length;
    // A header of labelled numbers ("R@5 R@20 R@5 R@20 …") is a run only when
    // it is nearly unbroken.
    if (bare < RUN_MIN_BARE_NUMBERS && density < LABELLED_RUN_MIN_DENSITY) return false;
    const stops = span.filter(t => t.kind === "stop").length;
    return (
        density >= RUN_MIN_DENSITY &&
        stops <= Math.max(1, Math.floor(span.length * RUN_MAX_STOP_SHARE))
    );
}

/** Tokens `from..to` (inclusive) are a non-empty stretch of labels: no stop words, no caption. */
function isLabelRun(tokens: Token[], from: number, to: number): boolean {
    if (from > to) return false;
    for (let i = from; i <= to; i++) {
        const token = tokens[i];
        if (!token || token.kind === "stop" || isCaptionStart(tokens, i)) return false;
        if (/[?!:;,]$/.test(token.text)) return false;
    }
    return true;
}

function isLabelGap(tokens: Token[], from: number, to: number): boolean {
    const gap = tokens.slice(from, to + 1);
    const words = gap.filter(t => t.kind === "word" || t.kind === "stop").length;
    const stops = gap.filter(t => t.kind === "stop").length;
    if (words > LABEL_MAX_WORDS || stops > 1) return false;
    for (let i = from; i <= to; i++) if (isCaptionStart(tokens, i)) return false;
    return true;
}

/**
 * A chart leaves axis ticks — evenly spaced integers ("0 200 400", "10 1 10
 * 2") — and axis words; a table leaves measured values.
 */
function residueKind(tokens: Token[]): "table" | "figure" {
    const numbers = tokens.filter(t => t.kind === "num").map(t => t.text.replace(/[^\d.+-]/g, ""));
    const integers = numbers.filter(n => /^[+-]?\d+$/.test(n));
    const axis = tokens.some(t => AXIS_WORD.test(t.text.replace(/[,;:]$/, "")));

    let progression = false;
    let logTicks = 0;
    for (let i = 0; i + 2 < tokens.length; i++) {
        const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]].map(t =>
            t && t.kind === "num" && /^\d+$/.test(t.text) ? Number(t.text) : NaN
        );
        if (a === undefined || b === undefined || c === undefined) continue;
        if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
        if (b - a === c - b && b !== a) progression = true;
        if (a === 10 && b > 0 && b < 10 && c === 10) logTicks++;
    }
    const integerShare = numbers.length ? integers.length / numbers.length : 0;
    return progression || logTicks > 0 || (axis && integerShare >= 0.6) ? "figure" : "table";
}

function majorityReason(spans: ResidueSpan[], tokens: Token[]): "table" | "figure" {
    let figure = 0;
    let table = 0;
    for (const span of spans) {
        const numbers = tokens.slice(span.from, span.to + 1).filter(isNumeric).length;
        if (span.reason === "figure") figure += numbers;
        else table += numbers;
    }
    return figure > table ? "figure" : "table";
}

/**
 * A diagram's labels flattened into one run: long, no stop words, no commas,
 * and either repeated tokens or stray symbols ("Retrieval Units Retrieval
 * Units Passage ? ✓ Query Corpus").
 */
function isDiagramLabels(tokens: Token[]): boolean {
    if (tokens.length < LABEL_SOUP_MIN_TOKENS) return false;
    if (tokens.some(t => t.kind === "stop" || /[,;]$/.test(t.text))) return false;
    if (tokens.filter(isNumeric).length > tokens.length / 10) return false;
    if (tokens.some(t => /[.!]$/.test(t.text) && t.kind === "word")) return false;
    const lettered = tokens.filter(t => /\p{L}{2}/u.test(t.text));
    if (lettered.length < tokens.length * 0.5) return false;
    const seen = new Set<string>();
    let repeats = 0;
    for (const token of lettered) {
        const key = token.text.toLowerCase();
        if (key.length >= 3 && seen.has(key)) repeats++;
        seen.add(key);
    }
    const symbols = tokens.filter(t => t.kind === "symbol").length;
    return repeats >= 2 || symbols >= 2;
}

/**
 * A table's header row and stray row labels survive as their own short,
 * stop-word-free "sentences" beside the numbers. Drop them with the table.
 */
function markTableNeighbours(sentences: Sentence[], removed: Record<DropReason, number>) {
    // The neighbour is residue where it touches this sentence: wholly, or a
    // cut that ends the previous sentence / opens the next one.
    const residue = (sentence: Sentence | undefined, side: "before" | "after") => {
        if (!sentence) return null;
        if (sentence.reason === "table" || sentence.reason === "figure") return sentence.reason;
        if (sentence.reason) return null;
        const cut = side === "before" ? sentence.cuts[sentence.cuts.length - 1] : sentence.cuts[0];
        if (!cut) return null;
        const touches = side === "before" ? !sentence.text.slice(cut.end).trim() : cut.start === 0;
        return touches ? cut.reason : null;
    };
    for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        sentences.forEach((sentence, i) => {
            if (sentence.reason || !isLabelSentence(sentence.text)) return;
            const reason =
                residue(sentences[i - 1], "before") ?? residue(sentences[i + 1], "after");
            if (!reason) return;
            drop(sentence, reason, removed);
            changed = true;
        });
        if (!changed) break;
    }
}

function isLabelSentence(text: string): boolean {
    const tokens = tokenize(text);
    if (tokens.length === 0 || tokens.length > LABEL_SENTENCE_MAX_TOKENS) return false;
    if (tokens.some((_, i) => isCaptionStart(tokens, i))) return false;
    return !tokens.some(t => t.kind === "stop");
}

// ============================================================================
// References
// ============================================================================

/** Citation metadata. Each is weak alone; references come in clusters. */
const CITATION_FEATURES = [
    /\bIn\s+(?:the\s+)?Proceedings\b|\bProceedings of\b/i,
    /\bFindings of\b/,
    /\bAssociation for Computational\b|\bComputational Linguistics\b/i,
    /\barXiv\b/i,
    /\bpages?\s+\d+\s*[–—-]\s*\d+|\bpp\.\s*\d+/i,
    /\b(?:Transactions|Journal|Advances|Annals|Letters)\s+(?:on|of|in)\b/,
    /\b(?:Conference|Symposium|Workshop|Meeting)\s+(?:on|of)\b|\bInternational Conference\b|\bAnnual Meeting\b/,
    /\b(?:CoRR|PMLR|ISBN|ISSN)\b|\babs\/\d{4}\.\d{4,5}|\bdoi(?:\.org)?[:/]/i,
    /\b\d+\s*\(\d+\)\s*[:,]\s*\d+|,\s*\d+\s*:\s*\d+\s*[–—-]\s*\d+/,
    /\bPreprint\b/,
    /\b(?:Vol\.|Volume)\s*\d+|\b(?:Long|Short) Papers\b/,
    // APA: "Smith, J., & Doe, A. (2020)."
    /^\p{Lu}[\p{L}'’-]+,\s+(?:\p{Lu}\.\s*)+.*\(\d{4}[a-z]?\)/u,
];

const REFERENCES_HEADING =
    /^(?:\d{1,2}\.?\s+)?(?:References|REFERENCES|Bibliography|BIBLIOGRAPHY|Works Cited|Literature Cited)\s*:?(?:\s{2,}|$)/;

/** A section heading ends a reference list: "A   Retrieval Corpus", "8   Conclusion". */
const SECTION_HEADING =
    /^(?:[A-Z]|\d{1,2}(?:\.\d{1,2})*)\s{2,}\p{Lu}\p{Ll}|^(?:Appendix|Acknowledg|Limitations)/u;

const FIRST_PERSON = /\b(?:we|our|us)\b/i;

const NAME_PARTICLES = new Set([
    "de",
    "del",
    "della",
    "der",
    "den",
    "di",
    "da",
    "du",
    "la",
    "le",
    "van",
    "von",
    "bin",
    "dos",
    "das",
    "ter",
    "ten",
]);

interface CitationSignal {
    features: number;
    year: boolean;
    authors: boolean;
    heading: boolean;
    words: number;
    firstPerson: boolean;
}

/**
 * Bibliography entries read as "Authors. Year. Title. Venue, pages." once
 * split into sentences. Venue and year sentences carry citation features;
 * an author list counts when it sits next to them; a title counts when it is
 * sandwiched between them. A "References" heading turns the rest of the chunk
 * into references when citations follow it. A narrative sentence with an
 * inline "(Chen et al., 2023)" carries no feature and is never touched.
 */
function markReferences(all: Sentence[], removed: Record<DropReason, number>) {
    const live = all.filter(sentence => !sentence.reason);
    const signals = live.map(sentence => citationSignal(sentence.text));
    const n = live.length;
    const ref = new Array<boolean>(n).fill(false);
    const signalAt = (i: number) => {
        const s = signals[i];
        return !!s && (s.features > 0 || s.year || s.authors);
    };
    const venueOrYear = (i: number) => {
        const s = signals[i];
        return !!s && (s.features > 0 || s.year);
    };

    // A "References" heading with citations after it.
    let inList = false;
    signals.forEach((signal, i) => {
        if (signal.heading) {
            const citations = signals.slice(i + 1).filter(s => s.features > 0 || s.year).length;
            inList = citations >= 2;
        } else if (inList && SECTION_HEADING.test(live[i]?.text ?? "")) {
            inList = false;
        }
        if (inList) ref[i] = true;
    });

    signals.forEach((signal, i) => {
        if (ref[i]) return;
        const nearby = [i - 2, i - 1, i + 1, i + 2].some(signalAt);
        if (signal.features > 0) {
            // A first-person sentence ("We presented at the Conference on X")
            // needs overwhelming evidence; an entry never says "we".
            const needed = signal.firstPerson ? 3 : 2;
            if (signal.features >= needed || (!signal.firstPerson && nearby)) ref[i] = true;
        } else if (signal.year) {
            const venueNearby = [i - 2, i + 2].some(j => (signals[j]?.features ?? 0) > 0);
            if (signalAt(i - 1) || signalAt(i + 1) || venueNearby) ref[i] = true;
        } else if (signal.authors) {
            if ([i - 2, i - 1, i + 1, i + 2].some(venueOrYear)) ref[i] = true;
        }
    });

    // Titles: one or two plain sentences between two references.
    const refShare = ref.filter(Boolean).length / Math.max(1, n);
    let i = 0;
    while (i < n) {
        if (ref[i]) {
            i++;
            continue;
        }
        let end = i;
        while (end + 1 < n && !ref[end + 1]) end++;
        const run = signals.slice(i, end + 1);
        const short = run.every(s => s.words <= 40);
        const plain = run.every(s => !s.firstPerson);
        const before = ref[i - 1] === true;
        const after = ref[end + 1] === true;
        const sandwiched =
            before && after && short && (run.length === 1 || (run.length === 2 && plain));
        const edge =
            run.length === 1 &&
            (run[0]?.words ?? 0) <= 25 &&
            plain &&
            refShare >= 0.5 &&
            ((i === 0 && after) || (end === n - 1 && before));
        if (sandwiched || edge) for (let k = i; k <= end; k++) ref[k] = true;
        i = end + 1;
    }

    live.forEach((sentence, k) => {
        if (ref[k]) drop(sentence, "references", removed);
    });
}

function citationSignal(text: string): CitationSignal {
    // Join line-break hyphenation so "Computa- tional" matches "Computational".
    const probe = collapse(text.replace(/(\p{L})-\s+(\p{L})/gu, "$1$2"));
    return {
        features: CITATION_FEATURES.filter(pattern => pattern.test(probe)).length,
        year: /^\(?(?:1[6-9]|20)\d{2}[a-z]?\)?[.,]?$/.test(probe),
        authors: isAuthorList(probe),
        heading: REFERENCES_HEADING.test(text),
        words: probe.split(" ").length,
        firstPerson: FIRST_PERSON.test(probe),
    };
}

/** "Zeynep Akkalyoncu Yilmaz, Wei Yang, and Jimmy Lin." — names and nothing else. */
function isAuthorList(probe: string): boolean {
    const body = probe
        .replace(/,?\s*et al\.?\s*$/, "")
        .replace(/[.,;]+\s*$/, "")
        .trim();
    if (!body || /\d/.test(body)) return false;
    const parts = body.split(/\s*,\s*(?:and\s+|&\s*)?|\s+(?:and|&)\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    for (const part of parts) {
        const words = part.split(/\s+/);
        if (words.length > 5) return false;
        let capitalised = 0;
        let lower = 0;
        for (const word of words) {
            if (NAME_PARTICLES.has(word.toLowerCase())) continue;
            if (/^\p{Lu}[\p{L}'’.-]*$/u.test(word)) capitalised++;
            // "Wen tau Yih": one lowercase piece inside a name, never a stop word.
            else if (/^\p{Ll}+$/u.test(word) && !STOPWORDS.has(word)) lower++;
            else return false;
        }
        if (capitalised === 0 || lower > 1 || (lower === 1 && capitalised < 2)) return false;
    }
    return true;
}

// ============================================================================
// Repeated sentences
// ============================================================================

/**
 * Drop a sentence of twelve words or more that this chunk or a kept earlier
 * chunk already said. Returns the new keys; the caller commits them only if
 * the chunk is kept, so a dropped chunk can't shadow a later copy.
 */
function markRepeatedSentences(
    sentences: Sentence[],
    seen: Set<string>,
    removed: Record<DropReason, number>
): string[] {
    const pending = new Set<string>();
    for (const sentence of sentences) {
        if (sentence.reason) continue;
        const text = keptText(sentence);
        if (text.split(/\s+/).length < REPEAT_MIN_WORDS) continue;
        const key = normalizeForMatch(text);
        if (seen.has(key) || pending.has(key)) drop(sentence, "duplicate", removed);
        else pending.add(key);
    }
    return [...pending];
}

// ============================================================================
// Small helpers
// ============================================================================

function emptyCounts(): Record<DropReason, number> {
    return {
        references: 0,
        table: 0,
        figure: 0,
        boilerplate: 0,
        placeholder: 0,
        too_short: 0,
        duplicate: 0,
    };
}

function collapse(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function nonSpace(text: string): number {
    return text.replace(/\s+/g, "").length;
}

function countLetters(text: string): number {
    return text.match(/\p{L}/gu)?.length ?? 0;
}
