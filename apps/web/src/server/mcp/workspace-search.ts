/**
 * Search over the documents one person may read in one workspace — the same
 * retrieval the Ask route runs, reusable outside a chat request (the MCP
 * server's `search` tool is the first caller).
 *
 * The scope is enforced three times, the way Ask does it: the candidate
 * document ids come from `scopedDocumentWhere`, every retrieval leg searches
 * only those ids, and `gateChunksByScope` re-checks whatever comes back.
 * Two legs return rows that are not passages of a document — notes (which can
 * be another person's) and company facts (a projection) — so they are dropped
 * here: a hit must be a passage of a document in the readable set.
 *
 * Results are grouped by document: one hit per document, in the order its
 * best passage ranked, with up to three snippets.
 */
import { and } from "drizzle-orm";

import { getCompanyEmbeddingConfig, resolveEmbeddingIndex } from "@launchstack/llm/embeddings";
import { document } from "@launchstack/store/schema";
import type { EmbeddingsProvider, SearchResult } from "@launchstack/retrieval/search-types";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { getEmbeddings } from "~/lib/models";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { multiDocEnsembleSearch } from "~/server/rag/ensemble";
import { gateChunksByScope } from "~/server/rag/gate";
import { documentInFolder } from "~/server/workspace-sources";

export { documentInFolder };

/** Leg outputs that are not a passage of a document. */
const NON_DOCUMENT_SOURCES = new Set(["note", "company_fact"]);

const SNIPPETS_PER_DOCUMENT = 3;
const SNIPPET_CHARS = 320;
export const SNIPPET_SEPARATOR = " … ";

export interface WorkspaceSearchInput {
    query: string;
    /** How many documents to return. */
    limit: number;
    /** A folder path; the folder and everything beneath it. */
    folder?: string;
}

export interface WorkspaceSearchHit {
    documentId: number;
    title: string;
    folder: string;
    /** Best first, at most three. */
    snippets: string[];
    /** The page of the best passage, when the document has pages. */
    page?: number;
}

export interface WorkspaceSearchDeps {
    /** The query embedder; tests pass a fake. Defaults to the company's configured index. */
    embeddingsFor?: (
        companyId: number
    ) => Promise<{ indexKey?: string; embeddings?: EmbeddingsProvider }>;
}

async function companyEmbeddings(
    companyId: number
): Promise<{ indexKey?: string; embeddings?: EmbeddingsProvider }> {
    const config = (await getCompanyEmbeddingConfig(companyId)) ?? undefined;
    try {
        const { indexKey } = resolveEmbeddingIndex(undefined, config);
        return { indexKey, embeddings: getEmbeddings(indexKey, config) };
    } catch (error) {
        // No embedder configured: the ensemble falls back to its lexical leg.
        console.warn("[mcp/search] embeddings unavailable, searching lexically", error);
        return {};
    }
}

/** The query as the lexical leg splits it: lowercased words, edge punctuation trimmed. */
function queryTerms(query: string): string[] {
    return query
        .toLowerCase()
        .split(/\s+/)
        .map(term => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .filter(term => term.length >= 2);
}

/**
 * The lexical leg always returns its full quota, padding with passages that
 * score zero; those share no word with the query. A search result list should
 * not, so they are dropped. Vector hits are kept as ranked: closeness in
 * meaning is the point of that leg.
 */
function isLexicalPadding(chunk: SearchResult, terms: readonly string[]): boolean {
    if (terms.length === 0 || chunkSource(chunk) !== "bm25") return false;
    const content = (chunk.pageContent ?? "").toLowerCase();
    return !terms.some(term => content.includes(term));
}

function numericDocumentId(chunk: SearchResult): number | null {
    const raw = chunk.metadata?.documentId ?? chunk.documentId;
    if (raw === undefined || raw === null || raw === "") return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
}

function chunkSource(chunk: SearchResult): string | undefined {
    const raw = chunk.metadata?.source ?? chunk.source;
    return typeof raw === "string" ? raw : undefined;
}

/**
 * A window of `content` around the first query term it contains, whitespace
 * collapsed, with ellipses where it was cut.
 */
export function snippetFor(content: string, query: string, max = SNIPPET_CHARS): string {
    const text = content.replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    const lower = text.toLowerCase();
    const terms = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(term => term.length >= 3)
        .sort((a, b) => b.length - a.length);
    let hit = -1;
    for (const term of terms) {
        hit = lower.indexOf(term);
        if (hit >= 0) break;
    }
    const start = hit < 0 ? 0 : Math.max(0, Math.min(hit - Math.floor(max / 4), text.length - max));
    const end = Math.min(text.length, start + max);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** One passage of a readable document, ranked for a query. */
export interface WorkspacePassage {
    documentId: number;
    title: string;
    folder: string;
    /** The retrieved chunk as the ensemble returned it (text, page, ids). */
    chunk: SearchResult;
}

/**
 * The passages of readable documents that best match a query, best first:
 * the ensemble over the person's readable ids (optionally one folder), gated
 * by their scope, with notes, company facts and the lexical leg's zero-score
 * padding dropped. `topK` is how many passages to ask the ensemble for.
 */
export async function findWorkspacePassages(
    ctx: WorkspaceContext,
    input: { query: string; topK: number; folder?: string },
    deps: WorkspaceSearchDeps = {}
): Promise<WorkspacePassage[]> {
    const scope = await ctx.documentScope();
    const companyId = Number(ctx.companyId);

    const readable = await db
        .select({ id: document.id, title: document.title, category: document.category })
        .from(document)
        .where(
            and(
                scopedDocumentWhere(ctx.companyId, scope),
                input.folder ? documentInFolder(input.folder) : undefined
            )
        );
    if (readable.length === 0) return [];
    const byId = new Map(readable.map(row => [Number(row.id), row]));

    const { indexKey, embeddings } = await (deps.embeddingsFor ?? companyEmbeddings)(companyId);
    const found = await multiDocEnsembleSearch(
        input.query,
        {
            weights: [0.4, 0.6],
            topK: input.topK,
            documentIds: [...byId.keys()],
            companyId,
            embeddingIndexKey: indexKey,
        },
        embeddings
    );

    const gated = await gateChunksByScope(found, {
        companyId: ctx.companyId,
        scope,
        searchScope: "mcp",
    });

    const terms = queryTerms(input.query);
    const passages: WorkspacePassage[] = [];
    for (const chunk of gated) {
        const source = chunkSource(chunk);
        if (source !== undefined && NON_DOCUMENT_SOURCES.has(source)) continue;
        if (isLexicalPadding(chunk, terms)) continue;
        const id = numericDocumentId(chunk);
        const row = id === null ? undefined : byId.get(id);
        if (id === null || !row) continue;
        passages.push({ documentId: id, title: row.title, folder: row.category, chunk });
    }
    return passages;
}

export async function searchWorkspace(
    ctx: WorkspaceContext,
    input: WorkspaceSearchInput,
    deps: WorkspaceSearchDeps = {}
): Promise<WorkspaceSearchHit[]> {
    // Several passages can come from one document, so ask for more passages
    // than documents; the ensemble merges sibling chunks of a section first.
    const topK = Math.min(50, Math.max(12, input.limit * 3));
    const passages = await findWorkspacePassages(
        ctx,
        { query: input.query, topK, folder: input.folder },
        deps
    );

    const hits = new Map<number, WorkspaceSearchHit>();
    for (const { documentId: id, title, folder, chunk } of passages) {
        const snippet = snippetFor(chunk.pageContent ?? "", input.query);
        if (snippet === "") continue;

        let hit = hits.get(id);
        if (!hit) {
            if (hits.size >= input.limit) continue;
            hit = { documentId: id, title, folder, snippets: [] };
            const page = chunk.metadata?.page;
            if (typeof page === "number" && Number.isInteger(page) && page > 0) hit.page = page;
            hits.set(id, hit);
        }
        if (hit.snippets.length < SNIPPETS_PER_DOCUMENT && !hit.snippets.includes(snippet)) {
            hit.snippets.push(snippet);
        }
    }
    return [...hits.values()];
}
