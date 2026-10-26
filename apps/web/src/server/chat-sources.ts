/**
 * What Ask tells the model about the files attached to a message, and how
 * the answer cites its sources.
 *
 * Retrieval hands the model the passages most like the question — a sample,
 * never the whole set. Unless the prompt says so, a model treats the sample as
 * everything: asked to list everyone across 37 attached resumes it listed the
 * 10 it was shown as "total", and said a person was missing whose resume was
 * attached. So a message with files attached now carries:
 *
 * - the list of attached files, each as `d12 · Title` — the id the source
 *   tools use (chat-source-tools.ts);
 * - that id and title on every passage, in place of a bare chunk number;
 * - one line saying how much of the attached set the model was shown, and
 *   that what it wasn't shown is unknown rather than absent.
 *
 * When the attached files fit the full-read budget, ranking is skipped and
 * every file goes in whole (what Claude Projects does under its context limit).
 *
 * The answer cites sources by id in brackets (lib/source-labels.ts);
 * `citeSources` turns the ids it used into the source list and removes them.
 */

import type { SearchResult } from "@launchstack/retrieval/search-types";

import { citedDocumentIds, sourceLabel, stripSourceLabels } from "~/lib/source-labels";

/** One attached file. */
export interface ScopeFile {
    id: number;
    /** `d12`: how the model names it. */
    label: string;
    title: string;
    /** Indexed size of the current version, in tokens (estimated where the index has none). */
    tokens: number;
    /** Indexed sections of the current version. */
    passages: number;
}

/** A file's id, title and indexed size, before it is labelled. */
export type ScopeFileRow = Omit<ScopeFile, "label">;

/** One indexed section of a file, in reading order. */
export interface SourcePassage {
    documentId: number;
    chunkId: number;
    versionId?: number;
    page?: number;
    /** As stored: a breadcrumb line (title › headings), then the text. */
    content: string;
}

/** Attached files up to this size are read whole; the rest of Ask's prompt keeps its own limit. */
export const FULL_READ_TOKEN_BUDGET = 60_000;
/** More attached files than this are never read whole, whatever their size. */
export const FULL_READ_MAX_FILES = 200;
/** Titles listed in the prompt; past this the model pages through `list_sources`. */
export const MANIFEST_MAX_LISTED = 150;
/** Sources an answer's source list may name. */
export const MAX_CITED_SOURCES = 50;

const CRUMB = " › ";

/** The attached files in title order, each labelled with its id. */
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
 * Whether the attached files are small enough to read whole. A file with
 * nothing indexed (still processing) would make a full read incomplete, so
 * the turn searches instead.
 */
export function fitsFullRead(files: readonly ScopeFile[]): boolean {
    if (files.length === 0 || files.length > FULL_READ_MAX_FILES) return false;
    if (files.some(file => file.passages === 0)) return false;
    return files.reduce((sum, file) => sum + file.tokens, 0) <= FULL_READ_TOKEN_BUDGET;
}

/**
 * A stored section as the model should read it under a file heading: the
 * breadcrumb's first step is the file's title, which the heading already
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

/** A file's sections as one text, with a page marker wherever the page changes. */
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

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** How much of the attached files the model was given. */
export type Coverage =
    | { mode: "full" }
    | { mode: "excerpts"; passages: number; filesShown: number }
    | { mode: "passage-only" };

/** How every answer cites a source; shared with the source tools' prompt. */
export const CITE_SOURCES =
    'Cite a source by its id in square brackets right after what you took from it, like "Rafael Chen [d12]" or "[d3, d12]", naming every id on its own, never a range like [d3-d9]. The app turns these into the list of sources under your answer, so don\'t write chunk numbers, page references or a source list of your own.';

/** The attached files, for the user message. */
export function manifestBlock(files: readonly ScopeFile[]): string {
    const listed = files.slice(0, MANIFEST_MAX_LISTED);
    const lines = listed.map(file => `${file.label} · ${file.title}`);
    const rest = files.length - listed.length;
    if (rest > 0) lines.push(`…and ${rest} more.`);
    return `Attached files (${files.length}):\n${lines.join("\n")}`;
}

/** How many attached files the given results came from. */
export function filesShown(results: readonly SearchResult[], files: readonly ScopeFile[]): number {
    const ids = new Set(files.map(file => file.id));
    return new Set(
        results.map(documentIdOf).filter((id): id is number => id !== null && ids.has(id))
    ).size;
}

/**
 * The system-prompt section for a message with files attached: what the
 * model has of them and, when it can look further, how.
 */
export function attachedFilesPrompt(
    files: readonly ScopeFile[],
    coverage: Coverage,
    hasTools: boolean
): string {
    const n = files.length;
    const lines = [
        "## The attached files",
        `The person attached ${n} file${n === 1 ? "" : "s"} to this message; they are listed with the question, each with its id.`,
        CITE_SOURCES,
        "When the person asks for everyone, everything or a count across the files, give the complete list or the exact count: a concise answer keeps the wording short, never leaves items out.",
    ];
    if (coverage.mode === "full") {
        lines.push(
            n === 1
                ? "You were given the file's complete text."
                : `You were given the complete text of all ${n} files, so you can answer about every one of them directly.`
        );
        return lines.join("\n");
    }
    lines.push(
        `${
            coverage.mode === "excerpts"
                ? `You were given ${coverage.passages} passage${coverage.passages === 1 ? "" : "s"} from ${coverage.filesShown} of the ${n} files, chosen by how closely they match the question.`
                : "You were given only the passage the person selected."
        } What you weren't shown is unknown, not absent: never say something isn't in the files, and never present a count or a list as complete, unless every file was checked.`
    );
    if (hasTools) {
        lines.push(
            "For a question about every attached file — list, count, find all, compare all, \"which of them\" — call `ask_each`, which asks every attached file the same question in parallel, rather than answering from the passages. A title is a file name, not the file's content: don't answer from titles."
        );
    } else if (n > 1) {
        lines.push(
            `If the question needs every file, answer from what you were shown and say plainly that it covers ${coverage.mode === "excerpts" ? coverage.filesShown : 0} of the ${n} files.`
        );
    }
    return lines.join("\n");
}

/** The retrieved passages, each under its file's id and title. */
export function excerptsBlock(
    results: readonly SearchResult[],
    files: readonly ScopeFile[]
): string {
    const byId = new Map(files.map(file => [file.id, file]));
    return results
        .map((result, idx) => {
            const metadata = (result.metadata ?? {}) as {
                page?: unknown;
                source?: unknown;
                documentTitle?: unknown;
            };
            const page = typeof metadata.page === "number" ? metadata.page : undefined;
            const id = documentIdOf(result);
            const file = id === null ? undefined : byId.get(id);
            // A company fact is a curated, cited statement, not a passage;
            // label it so the model treats it as such (ADR-011).
            const heading =
                metadata.source === "company_fact"
                    ? `=== Company fact #${idx + 1}${
                          typeof metadata.documentTitle === "string"
                              ? ` (from ${metadata.documentTitle})`
                              : ""
                      } ===`
                    : file
                      ? `=== [${file.label}] ${file.title}${page !== undefined ? ` · page ${page}` : ""} ===`
                      : `=== Passage #${idx + 1}${page !== undefined ? `, page ${page}` : ""} ===`;
            return `${heading}\n${result.pageContent}`;
        })
        .join("\n\n");
}

/** Every attached file whole, each under its id and title. */
export function fullReadBlock(
    files: readonly ScopeFile[],
    passagesByFile: ReadonlyMap<number, readonly SourcePassage[]>
): string {
    return files
        .map(
            file =>
                `=== [${file.label}] ${file.title} ===\n${fileText(passagesByFile.get(file.id) ?? [])}`
        )
        .join("\n\n");
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
            // Attached and cited without a passage of it in view (from its
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
