/**
 * What Ask tells the model about the sources in a message, and how the
 * answer cites them.
 *
 * Retrieval hands the model the passages most like the question — a sample,
 * never the whole set. Unless the prompt says so, a model treats the sample as
 * everything: asked to list everyone across 37 attached resumes it listed the
 * 10 it was shown as "total", and said a person was missing whose resume was
 * attached. So the sources travel in the person's message as tagged blocks
 * (docs/design/inline-source-context.md):
 *
 * - `<documents>` opens the message, one `<document id="d12" title=… coverage=…>`
 *   per source with content — the id the source tools use
 *   (chat-source-tools.ts) and the words name (chat-mentions.ts) — and a
 *   `<not_shown>` line for the rest of the set;
 * - `coverage` says how much of each the model was given, and the system
 *   prompt says that what it wasn't shown is unknown rather than absent;
 * - files uploaded with the message follow in `<attachments>`;
 * - the person's words come last, with each chip rendered `"Title" (d12)`.
 *
 * When the set fits the full-read budget, ranking is skipped and every source
 * goes in whole (what Claude Projects does under its context limit).
 *
 * The answer cites sources by id in brackets (lib/source-labels.ts);
 * `citeSources` turns the ids it used into the source list and removes them.
 */

import type { SearchResult } from "@launchstack/retrieval/search-types";

import { citedDocumentIds, sourceLabel, stripSourceLabels } from "~/lib/source-labels";
import { quoteName } from "~/lib/source-mentions";

/** One source in scope for the message. */
export interface ScopeFile {
    id: number;
    /** `d12`: how the model names it. */
    label: string;
    title: string;
    /** Indexed size of the current version, in tokens (estimated where the index has none). */
    tokens: number;
    /** Indexed sections of the current version. */
    passages: number;
    /** The folder it is filed in, when known. */
    folder?: string | null;
    /** Where it came from, as people say it ("Google Drive"), when imported. */
    from?: string | null;
}

/** A source's id, title and indexed size, before it is labelled. */
export type ScopeFileRow = Omit<ScopeFile, "label">;

/** One indexed section of a source, in reading order. */
export interface SourcePassage {
    documentId: number;
    chunkId: number;
    versionId?: number;
    page?: number;
    /** As stored: a breadcrumb line (title › headings), then the text. */
    content: string;
}

/** Sources up to this size are read whole; the rest of Ask's prompt keeps its own limit. */
export const FULL_READ_TOKEN_BUDGET = 60_000;
/** More sources than this are never read whole, whatever their size. */
export const FULL_READ_MAX_FILES = 200;
/** Titles listed in `<not_shown>`; past this the model pages through `list_sources`. */
export const MANIFEST_MAX_LISTED = 150;
/** Sources an answer's source list may name. */
export const MAX_CITED_SOURCES = 50;

const CRUMB = " › ";

/** The sources in title order, each labelled with its id. */
export function labelScopeFiles(rows: readonly ScopeFileRow[]): ScopeFile[] {
    return [...rows]
        .sort(
            (a, b) =>
                a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) ||
                a.id - b.id
        )
        .map(row => ({ ...row, label: sourceLabel(row.id) }));
}

/**
 * Whether the sources are small enough to read whole. One with nothing
 * indexed (still processing) would make a full read incomplete, so the turn
 * searches instead.
 */
export function fitsFullRead(files: readonly ScopeFile[]): boolean {
    if (files.length === 0 || files.length > FULL_READ_MAX_FILES) return false;
    if (files.some(file => file.passages === 0)) return false;
    return files.reduce((sum, file) => sum + file.tokens, 0) <= FULL_READ_TOKEN_BUDGET;
}

/**
 * A stored section as the model should read it under a source heading: the
 * breadcrumb's first step is the source's title, which the heading already
 * shows, so it is dropped and the section path kept.
 */
export function passageText(content: string): string {
    const breakAt = content.indexOf("\n\n");
    if (breakAt <= 0) return content.trim();
    const firstLine = content.slice(0, breakAt);
    if (!firstLine.includes(CRUMB) || firstLine.length > 300 || firstLine.includes("\n")) {
        return content.trim();
    }
    const body = content.slice(breakAt + 2).trim();
    const path = firstLine.split(CRUMB).slice(1).join(CRUMB).trim();
    return path ? `[${path}]\n${body}` : body;
}

/** A source's sections as one text, with a page marker wherever the page changes. */
export function fileText(passages: readonly SourcePassage[]): string {
    let page: number | undefined;
    const parts: string[] = [];
    for (const passage of passages) {
        if (passage.page !== undefined && passage.page !== page) {
            page = passage.page;
            parts.push(`(page ${page})`);
        }
        parts.push(passageText(passage.content));
    }
    return parts.join("\n\n");
}

/** A section as a retrieval result, so citations and the scope gate treat it like one. */
export function passageResult(passage: SourcePassage, file: ScopeFile): SearchResult {
    return {
        pageContent: passage.content,
        metadata: {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            versionId: passage.versionId,
            page: passage.page,
            documentTitle: file.title,
            source: "full_read",
            searchScope: "multi-document",
        },
    };
}

function documentIdOf(result: SearchResult): number | null {
    const raw = (result.metadata as { documentId?: unknown } | undefined)?.documentId;
    const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(id) ? id : null;
}

function numberOf(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/** How much of the sources the model was given. */
export type Coverage =
    | { mode: "full" }
    /** The sources named in the words read whole; the rest of the set searched. */
    | { mode: "mixed"; whole: number; passages: number; filesShown: number }
    | { mode: "excerpts"; passages: number; filesShown: number }
    | { mode: "passage-only" };

/**
 * The sources, in the order given, that fit the full-read budget together:
 * the ones the person named in their words are read whole first when the
 * whole set cannot be. One with nothing indexed is skipped.
 */
export function filesWithinBudget(files: readonly ScopeFile[]): ScopeFile[] {
    const picked: ScopeFile[] = [];
    let tokens = 0;
    for (const file of files) {
        if (file.passages === 0) continue;
        if (picked.length >= FULL_READ_MAX_FILES || tokens + file.tokens > FULL_READ_TOKEN_BUDGET)
            break;
        picked.push(file);
        tokens += file.tokens;
    }
    return picked;
}

/** How every answer cites a source; shared with the source tools' prompt. */
export const CITE_SOURCES =
    'Cite a source by its id in square brackets right after what you took from it, like "Rafael Chen [d12]" or "[d3, d12]", naming every id on its own, never a range like [d3-d9]. The app turns these into the list of sources under your answer, so don\'t write chunk numbers, page references or a source list of your own.';

/** A value inside a tag's quotes: one line, no quotes or angle brackets, not a paragraph. */
function attribute(value: string): string {
    const flat = value.replace(/\s+/g, " ").trim();
    const cut = flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
    return cut
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** A source's text cannot close its own block, whatever it contains. */
function body(text: string): string {
    return text.replace(
        /<\/(documents?|attachments?|passage|company_fact|not_shown)\b/gi,
        "&lt;/$1"
    );
}

function element(
    name: string,
    attributes: Record<string, string | null | undefined>,
    content: string
): string {
    const open = Object.entries(attributes)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([key, value]) => ` ${key}="${attribute(value)}"`)
        .join("");
    const inner = body(content.trim());
    return inner ? `<${name}${open}>\n${inner}\n</${name}>` : `<${name}${open}></${name}>`;
}

function documentElement(
    file: Pick<ScopeFile, "id" | "label" | "title" | "folder" | "from">,
    coverage: string,
    content: string
): string {
    return element(
        "document",
        { id: file.label, title: file.title, folder: file.folder, from: file.from, coverage },
        content || "(no text indexed)"
    );
}

/** How many sources the given results came from. */
export function filesShown(results: readonly SearchResult[], files: readonly ScopeFile[]): number {
    const ids = new Set(files.map(file => file.id));
    return new Set(
        results.map(documentIdOf).filter((id): id is number => id !== null && ids.has(id))
    ).size;
}

/** The sources in scope with nothing of them in the message, listed by id and title. */
function notShownElement(files: readonly ScopeFile[]): string {
    const listed = files.slice(0, MANIFEST_MAX_LISTED);
    const items = listed.map(file => `${file.label} ${quoteName(file.title)}`);
    const rest = files.length - listed.length;
    if (rest > 0) items.push(`…and ${rest} more`);
    return element("not_shown", { count: String(files.length) }, items.join(", "));
}

/** A retrieved result as a section, so a searched source reads like a read one. */
function sectionOf(result: SearchResult, documentId: number): SourcePassage {
    const metadata = (result.metadata ?? {}) as { chunkId?: unknown; page?: unknown };
    return {
        documentId,
        chunkId: numberOf(metadata.chunkId) ?? 0,
        page: numberOf(metadata.page),
        content: result.pageContent,
    };
}

/** Reading order within one source: by page, then by section id; ties keep rank order. */
function readingOrder(a: SourcePassage, b: SourcePassage): number {
    const page = (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER);
    if (page !== 0) return page;
    return a.chunkId && b.chunkId ? a.chunkId - b.chunkId : 0;
}

export interface DocumentsInput {
    /** The sources in scope, labelled. */
    files: readonly ScopeFile[];
    /** Every source whole (the full read), or null when the set was searched. */
    whole: ReadonlyMap<number, readonly SourcePassage[]> | null;
    /** The retrieved passages, in rank order, when the set was searched. */
    results: readonly SearchResult[];
}

/**
 * The `<documents>` block that opens the person's message: one `<document>`
 * per source with content, under its id and title, with how much of it is
 * there; the sources with nothing shown listed once; a company fact (a
 * curated, cited statement, not a passage — ADR-011) and a passage from no
 * known source each labelled as such. Empty when there is nothing to show.
 */
export function documentsBlock({ files, whole, results }: DocumentsInput): string {
    const byId = new Map(files.map(file => [file.id, file]));
    const blocks: string[] = [];
    const shown = new Set<number>();

    // Read whole: every source in `whole`, which is the full set or, when
    // that is too large, the ones the person named in their words.
    for (const file of files) {
        if (!whole?.has(file.id)) continue;
        blocks.push(documentElement(file, "complete", fileText(whole.get(file.id) ?? [])));
        shown.add(file.id);
    }
    {
        const groups = new Map<number, SourcePassage[]>();
        const titles = new Map<number, string>();
        const loose: string[] = [];
        let index = 0;
        for (const result of results) {
            index += 1;
            const metadata = (result.metadata ?? {}) as {
                source?: unknown;
                documentTitle?: unknown;
                page?: unknown;
            };
            const title =
                typeof metadata.documentTitle === "string" ? metadata.documentTitle : null;
            if (metadata.source === "company_fact") {
                loose.push(element("company_fact", { source: title }, result.pageContent));
                continue;
            }
            const id = documentIdOf(result);
            // A section of a source already read whole adds nothing.
            if (id !== null && shown.has(id)) continue;
            if (id === null) {
                const page = numberOf(metadata.page);
                loose.push(
                    element(
                        "passage",
                        { index: String(index), page: page === undefined ? null : String(page) },
                        result.pageContent
                    )
                );
                continue;
            }
            const group = groups.get(id);
            if (group) group.push(sectionOf(result, id));
            else groups.set(id, [sectionOf(result, id)]);
            if (title && !titles.has(id)) titles.set(id, title);
        }
        for (const [id, sections] of groups) {
            const file = byId.get(id);
            const total = file?.passages ?? 0;
            const n = sections.length;
            const coverage =
                total > 0
                    ? `excerpts: ${n} of ${total} section${total === 1 ? "" : "s"}, chosen by the question`
                    : `excerpts: ${n} section${n === 1 ? "" : "s"}, chosen by the question`;
            blocks.push(
                documentElement(
                    file ?? {
                        id,
                        label: sourceLabel(id),
                        title: titles.get(id) ?? sourceLabel(id),
                    },
                    coverage,
                    fileText([...sections].sort(readingOrder))
                )
            );
            shown.add(id);
        }
        blocks.push(...loose);
    }

    const rest = files.filter(file => !shown.has(file.id));
    if (rest.length > 0) blocks.push(notShownElement(rest));
    return blocks.length === 0 ? "" : `<documents>\n${blocks.join("\n")}\n</documents>`;
}

/** A file uploaded with the message, read for the prompt. */
export interface AttachmentEntry {
    name: string;
    mimeType?: string;
    /** Its text, or empty when there is none to give. */
    text: string;
    /** `complete`, `cut at N of M characters`, or why there is no text. */
    coverage: string;
}

/** The `<attachments>` block: files uploaded with this message, each under its name. */
export function attachmentsBlock(entries: readonly AttachmentEntry[]): string {
    if (entries.length === 0) return "";
    const blocks = entries.map(entry =>
        element(
            "attachment",
            { name: entry.name, type: entry.mimeType, coverage: entry.coverage },
            entry.text
        )
    );
    return `<attachments>\n${blocks.join("\n")}\n</attachments>`;
}

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

/**
 * The system-prompt section for a message with sources: what the blocks
 * are, how the words name them, how much the model has of them and, when it
 * can look further, how.
 */
export function sourcesPrompt(
    files: readonly ScopeFile[],
    coverage: Coverage,
    hasTools: boolean,
    options: { unavailable?: number } = {}
): string {
    const n = files.length;
    const unavailable = options.unavailable ?? 0;
    const lines = [
        "## Sources in this message",
        'The person\'s message opens with <documents>: each <document> is a workspace source in scope for this message — one they attached, or one of the set being searched — named by its id and title, with a coverage attribute saying how much of it you were given. Their words come last; a source they point at reads "Title" (d12) and is the block with that id. <attachments> are files uploaded with this message: they are not workspace sources and cannot be cited.',
    ];
    if (unavailable > 0) {
        lines.push(
            `${unavailable === 1 ? "One source" : `${unavailable} sources`} in their words read${unavailable === 1 ? "s" : ""} (unavailable): they cannot open ${unavailable === 1 ? "it" : "them"} here, so you have nothing of ${unavailable === 1 ? "it" : "them"}; say so if the question needs ${unavailable === 1 ? "it" : "one"}.`
        );
    }
    // Uploads alone: nothing to cite, nothing to count.
    if (n === 0) return lines.join("\n");
    lines.push(
        CITE_SOURCES,
        "When the person asks for everyone, everything or a count across the sources, give the complete list or the exact count: a concise answer keeps the wording short, never leaves items out."
    );
    if (coverage.mode === "full") {
        lines.push(
            n === 1
                ? "You were given the source's complete text."
                : `You were given the complete text of all ${n} sources, so you can answer about every one of them directly.`
        );
        return lines.join("\n");
    }
    lines.push(
        `${
            coverage.mode === "mixed"
                ? `You were given the complete text of ${coverage.whole} of the ${n} sources — the ${coverage.whole === 1 ? "one" : "ones"} named in the words — and ${coverage.passages} passage${coverage.passages === 1 ? "" : "s"} from ${coverage.filesShown} of the others, chosen by how closely they match the question.`
                : coverage.mode === "excerpts"
                  ? `You were given ${coverage.passages} passage${coverage.passages === 1 ? "" : "s"} from ${coverage.filesShown} of the ${n} sources, chosen by how closely they match the question.`
                  : "You were given only the passage the person selected."
        } What you weren't shown is unknown, not absent: never say something isn't in the sources, and never present a count or a list as complete, unless every source was checked.`
    );
    if (hasTools) {
        lines.push(
            "For a question about every source in scope — list, count, find all, compare all, \"which of them\" — call `ask_each`, which asks every one of them the same question in parallel, rather than answering from the passages. A title is a file name, not the file's content: don't answer from titles."
        );
    } else if (n > 1) {
        lines.push(
            `If the question needs every source, answer from what you were shown and say plainly that it covers ${coverage.mode === "excerpts" ? coverage.filesShown : coverage.mode === "mixed" ? coverage.whole + coverage.filesShown : 0} of the ${n} sources.`
        );
    }
    return lines.join("\n");
}

/**
 * The system-prompt section that says what to answer from. It used to trail
 * the person's words inside the message; a rule belongs with the rules, and
 * the words stay the last thing the model reads.
 */
export function answeringPrompt(options: {
    /** The turn searched a set of sources (anything but `searchScope: "none"`). */
    scoped: boolean;
    sourceTools: boolean;
    web: boolean;
    history: boolean;
    /** The person sent sources with no words of their own. */
    wordsOmitted: boolean;
}): string {
    const lines = ["## Answering"];
    if (options.scoped) {
        lines.push(
            options.sourceTools
                ? "Answer from the documents in the message when they cover the question; when a part is missing or its full context needs checking, use list_sources, search_sources and read_source."
                : "Answer from the documents in the message when they cover the question."
        );
    } else if (options.sourceTools) {
        lines.push(
            "Answer using what you find in the workspace's sources when the question is about them, the files attached to this message when there are any, and your general knowledge."
        );
    } else {
        lines.push(
            "Answer using the files attached to this message when there are any, and your general knowledge."
        );
    }
    if (options.web)
        lines.push("When you use information from web sources, cite them as [Source N].");
    if (options.history)
        lines.push(
            "<history> holds the earlier turns of this conversation; continue it naturally and refer back to them when relevant."
        );
    if (options.wordsOmitted)
        lines.push(
            "This message has no words of the person's own, only the sources above: give a short orientation — what each one is and what stands out — and offer what you could do with them next."
        );
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
    "the and for are was were with from that this have has had not but you your they their them his her its our who what when where which how all any can will would should could into about over than then also more most such very".split(
        " "
    )
);

function words(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(word => word.length >= 3 && !STOPWORDS.has(word))
    );
}

/** The answer's sentences that cite `id`: what its passage should match. */
function citingContext(answer: string, id: number): string {
    const cites = new RegExp(String.raw`[\[(][^\])]*\b[dD]${id}\b[^\])]*[\])]`);
    return answer
        .split(/\n+|(?<=[.!?])\s+/)
        .filter(sentence => cites.test(sentence))
        .join(" ");
}

/** The passage that best supports what the answer says; an `ask_each` quote wins ties. */
function bestPassage(
    candidates: readonly SearchResult[],
    context: string
): SearchResult | undefined {
    if (candidates.length <= 1) return candidates[0];
    const wanted = words(context);
    let best: SearchResult | undefined;
    let bestScore = -1;
    for (const candidate of candidates) {
        let score = 0;
        for (const word of words(candidate.pageContent)) if (wanted.has(word)) score += 2;
        if ((candidate.metadata as { source?: unknown }).source === "ask_each") score += 1;
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

/**
 * The answer with its source ids removed, and one passage per cited source
 * for the source list, in the order the answer first cites them. Only a
 * source the model was shown can be cited: an id from nowhere is dropped.
 * `cited` is null when the answer cites none; the caller then falls back to
 * what was retrieved.
 */
export function citeSources(
    answer: string,
    shown: readonly SearchResult[],
    attached: readonly ScopeFile[]
): { text: string; cited: SearchResult[] | null } {
    const byFile = new Map<number, SearchResult[]>();
    for (const result of shown) {
        const id = documentIdOf(result);
        if (id === null) continue;
        const list = byFile.get(id);
        if (list) list.push(result);
        else byFile.set(id, [result]);
    }
    const titleOf = new Map(attached.map(file => [file.id, file.title]));

    const cited: SearchResult[] = [];
    const known = [...byFile.keys(), ...titleOf.keys()];
    for (const id of citedDocumentIds(answer, known)) {
        if (cited.length >= MAX_CITED_SOURCES) break;
        const passage = bestPassage(byFile.get(id) ?? [], citingContext(answer, id));
        if (passage) {
            cited.push(passage);
            continue;
        }
        const title = titleOf.get(id);
        if (title) {
            // In scope and cited without a passage of it in view (from its
            // title): the source list still names it.
            cited.push({
                pageContent: title,
                metadata: { documentId: id, documentTitle: title, searchScope: "multi-document" },
            });
        }
    }
    return { text: stripSourceLabels(answer), cited: cited.length > 0 ? cited : null };
}

/** The first passage of each source, in order: the source list when the answer cites none. */
export function onePerSource(results: readonly SearchResult[]): SearchResult[] {
    const seen = new Set<number>();
    const out: SearchResult[] = [];
    for (const result of results) {
        const id = documentIdOf(result);
        if (id !== null) {
            if (seen.has(id)) continue;
            seen.add(id);
        }
        out.push(result);
        if (out.length >= MAX_CITED_SOURCES) break;
    }
    return out;
}
