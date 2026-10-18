/**
 * The sources one person may open in one workspace, as the tools that let a
 * model look through them need them: the MCP server's `list_sources` and
 * `fetch`, and Ask's source tools (chat-source-tools.ts). Search lives next
 * to the MCP server in `mcp/workspace-search.ts`.
 *
 * Every query here is narrowed by `scopedDocumentWhere`, so a document the
 * person cannot open is never listed, counted or read. Counts come from the
 * readable documents, never from the folder table: a visible folder can hold
 * a restricted document, and its count must not reveal one.
 *
 * A source's origin is the connector that imported it (`ocr_metadata.connector`,
 * written by each connector's sink); a document with none was added in
 * LaunchStack itself — uploaded, written or generated here.
 */
import { and, asc, desc, eq, isNull, like, or, sql, type SQL } from "drizzle-orm";

import { document, documentContextChunks } from "@launchstack/store/schema";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { normalizeFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { descendantPattern } from "~/server/folders";

/** What each connector's imports are called, keyed by its connector id. */
export const SOURCE_ORIGINS = {
    "google-drive": "Google Drive",
    gmail: "Gmail",
    // Imported Claude Code / Codex sessions (the Add a source tab's name).
    "agent-sessions": "Coding sessions",
    // Claude Code / Codex knowledge files (CLAUDE.md, memory).
    "agent-knowledge": "Coding agent knowledge",
    // Conversations an assistant saved over MCP (save_conversation).
    "assistant-conversations": "Saved AI conversations",
} as const satisfies Record<string, string>;

export type SourceOriginId = keyof typeof SOURCE_ORIGINS;

/** The `from` filter's value for sources no connector imported. */
export const ADDED_HERE = "added-here";

export type SourceOriginFilter = SourceOriginId | typeof ADDED_HERE;

export const SOURCE_ORIGIN_FILTERS: readonly SourceOriginFilter[] = [
    ...(Object.keys(SOURCE_ORIGINS) as SourceOriginId[]),
    ADDED_HERE,
];

export function isSourceOriginFilter(value: unknown): value is SourceOriginFilter {
    return (SOURCE_ORIGIN_FILTERS as readonly unknown[]).includes(value);
}

/** The connector that imported a document, or null for one added here. */
function originColumn() {
    return sql<string | null>`${document.ocrMetadata} ->> 'connector'`;
}

/** A connector id as people say it ("Google Drive"); null for none, the id for one we don't name. */
export function originLabel(connector: string | null | undefined): string | null {
    if (!connector) return null;
    return (SOURCE_ORIGINS as Record<string, string>)[connector] ?? connector;
}

/** `document.category` is the folder or anything beneath it. */
export function documentInFolder(folder: string): SQL {
    const path = normalizeFolderPath(folder);
    return or(eq(document.category, path), like(document.category, descendantPattern(path)))!;
}

function documentFrom(from: SourceOriginFilter): SQL {
    return from === ADDED_HERE ? isNull(originColumn()) : eq(originColumn(), from);
}

// --- listing ----------------------------------------------------------------

export interface ListCursor {
    /** `coalesce(updated_at, created_at)::text` of the last row on the page. */
    at: string;
    id: number;
}

const TIMESTAMP_TEXT =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

export function encodeListCursor(cursor: ListCursor): string {
    return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id }), "utf8").toString(
        "base64url"
    );
}

export function decodeListCursor(raw: string): ListCursor | null {
    try {
        const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
        if (typeof value !== "object" || value === null) return null;
        const { at, id } = value as Record<string, unknown>;
        if (typeof at !== "string" || !TIMESTAMP_TEXT.test(at)) return null;
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
        return { at, id };
    } catch {
        return null;
    }
}

export interface ListSourcesInput {
    /** A folder path; the folder and everything beneath it. */
    folder?: string;
    from?: SourceOriginFilter;
    limit: number;
    cursor?: ListCursor | null;
}

export interface ListedSource {
    id: number;
    title: string;
    folder: string;
    /** The connector id that imported it (a SourceOriginId); absent for a source added here. */
    from?: string;
    updatedAt: Date;
}

export interface SourceListing {
    /** Folders holding readable sources, each with how many it holds directly. */
    folders: Array<{ path: string; documentCount: number }>;
    /** Newest change first. */
    documents: ListedSource[];
    /** Present when there are more documents; pass it back as the cursor. */
    nextCursor?: string;
}

/**
 * The folders that hold readable sources and the sources themselves, newest
 * first, a page at a time. Paging is keyset, on (last change, id), so a
 * source added between pages neither repeats nor pushes another off a page;
 * the cursor carries the sort key as Postgres printed it, microseconds and all.
 */
export async function listReadableSources(
    ctx: WorkspaceContext,
    input: ListSourcesInput
): Promise<SourceListing> {
    const readable = and(
        scopedDocumentWhere(ctx.companyId, await ctx.documentScope()),
        input.folder ? documentInFolder(input.folder) : undefined,
        input.from ? documentFrom(input.from) : undefined
    );
    const changedAt = sql`coalesce(${document.updatedAt}, ${document.createdAt})`;
    const cursor = input.cursor ?? null;

    const [folderRows, documentRows] = await Promise.all([
        db
            .select({ path: document.category, count: sql<number>`count(*)::int` })
            .from(document)
            .where(readable)
            .groupBy(document.category)
            .orderBy(asc(document.category)),
        db
            .select({
                id: document.id,
                title: document.title,
                category: document.category,
                origin: originColumn(),
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
                sortKey: sql<string>`(${changedAt})::text`,
            })
            .from(document)
            .where(
                and(
                    readable,
                    cursor
                        ? sql`(${changedAt}, ${document.id}) < (${cursor.at}::timestamptz, ${cursor.id})`
                        : undefined
                )
            )
            .orderBy(desc(changedAt), desc(document.id))
            .limit(input.limit + 1),
    ]);

    const page = documentRows.slice(0, input.limit);
    const last = page[page.length - 1];
    const listing: SourceListing = {
        folders: folderRows.map(row => ({ path: row.path, documentCount: Number(row.count) })),
        documents: page.map(row => ({
            id: Number(row.id),
            title: row.title,
            folder: row.category,
            ...(row.origin ? { from: row.origin } : {}),
            updatedAt: row.updatedAt ?? row.createdAt,
        })),
    };
    if (documentRows.length > input.limit && last) {
        listing.nextCursor = encodeListCursor({ at: last.sortKey, id: Number(last.id) });
    }
    return listing;
}

/** How many sources the person can open, and how many came from each connector. */
export interface SourceInventory {
    total: number;
    /** Largest first; `from` is null for sources added here. */
    byOrigin: Array<{ from: string | null; count: number }>;
}

export async function summarizeReadableSources(ctx: WorkspaceContext): Promise<SourceInventory> {
    const rows = await db
        .select({ from: originColumn(), count: sql<number>`count(*)::int` })
        .from(document)
        .where(scopedDocumentWhere(ctx.companyId, await ctx.documentScope()))
        .groupBy(originColumn());
    const byOrigin = rows
        .map(row => ({ from: row.from ?? null, count: Number(row.count) }))
        .filter(row => row.count > 0)
        .sort((a, b) => b.count - a.count);
    return { total: byOrigin.reduce((sum, row) => sum + row.count, 0), byOrigin };
}

// --- finding by title ---------------------------------------------------------

/** Words too common to say anything about which source is meant. */
const TITLE_STOPWORDS = new Set(
    (
        "a an and are about did do does doc docs document documents file files for from how in is " +
        "me my of on our say says source sources that the there this to us we what whats which who with your"
    ).split(" ")
);

/** The words of a query a title can match: lowercased, at least two characters, no stopwords. */
export function titleTerms(query: string): string[] {
    const words = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length >= 2 && !TITLE_STOPWORDS.has(word));
    return [...new Set(words)].slice(0, 8);
}

function likePattern(term: string): string {
    return `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

/**
 * Readable sources whose titles share words with a query, most shared words
 * first. A person who names a source ("the Q4 cash forecast") means that
 * source; its title says so more surely than any passage ranking. A title
 * must share two of the query's words (one when the query has only one).
 */
export async function findSourcesByTitle(
    ctx: WorkspaceContext,
    query: string,
    limit = 5
): Promise<ListedSource[]> {
    const terms = titleTerms(query);
    if (terms.length === 0) return [];
    const matched = sql<number>`(${sql.join(
        terms.map(term => sql`(${document.title} ilike ${likePattern(term)})::int`),
        sql` + `
    )})`;
    const rows = await db
        .select({
            id: document.id,
            title: document.title,
            category: document.category,
            origin: originColumn(),
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
            matched,
        })
        .from(document)
        .where(
            and(
                scopedDocumentWhere(ctx.companyId, await ctx.documentScope()),
                sql`${matched} >= ${Math.min(2, terms.length)}`
            )
        )
        .orderBy(desc(matched), desc(sql`coalesce(${document.updatedAt}, ${document.createdAt})`))
        .limit(limit);
    return rows.map(row => ({
        id: Number(row.id),
        title: row.title,
        folder: row.category,
        ...(row.origin ? { from: row.origin } : {}),
        updatedAt: row.updatedAt ?? row.createdAt,
    }));
}

// --- reading ----------------------------------------------------------------

/** About fifty pages of dense text; longer documents are cut and say so. */
export const SOURCE_TEXT_MAX_CHARS = 200_000;

const CHUNK_SEPARATOR = "\n\n";

/** Joins chunks in order, stopping at `max` characters. */
export function joinChunkText(
    chunks: readonly string[],
    max = SOURCE_TEXT_MAX_CHARS
): { text: string; characters: number; truncated: boolean } {
    const parts = chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);
    const full = parts.join(CHUNK_SEPARATOR);
    if (full.length <= max) return { text: full, characters: full.length, truncated: false };
    return { text: full.slice(0, max), characters: full.length, truncated: true };
}

export interface SourceText {
    id: number;
    title: string;
    folder: string;
    from?: string;
    mimeType: string | null;
    createdAt: Date;
    updatedAt: Date;
    text: string;
    /** Length of the full text, before any cut. */
    characters: number;
    truncated: boolean;
    /** False while the document has no extracted text (still processing, or none). */
    indexed: boolean;
}

/**
 * One readable document's current text: the current version's context
 * chunks in reading order, as plain text (the rows the in-app text view
 * renders as HTML). Null for a missing id and an unreadable one alike.
 */
export async function readSourceText(
    ctx: WorkspaceContext,
    documentId: number,
    maxChars = SOURCE_TEXT_MAX_CHARS
): Promise<SourceText | null> {
    const [row] = await db
        .select({
            id: document.id,
            title: document.title,
            category: document.category,
            origin: originColumn(),
            currentVersionId: document.currentVersionId,
            mimeType: document.mimeType,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
        })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(ctx.companyId, await ctx.documentScope())
            )
        )
        .limit(1);
    if (!row) return null;

    // A document without a current version has no current text; never fall
    // back to an older version's chunks.
    const chunks =
        row.currentVersionId === null
            ? []
            : await db
                  .select({ content: documentContextChunks.content })
                  .from(documentContextChunks)
                  .where(
                      and(
                          eq(documentContextChunks.documentId, BigInt(documentId)),
                          eq(documentContextChunks.versionId, row.currentVersionId)
                      )
                  )
                  .orderBy(asc(documentContextChunks.pageNumber), asc(documentContextChunks.id));

    const { text, characters, truncated } = joinChunkText(
        chunks.map(chunk => chunk.content),
        maxChars
    );
    return {
        id: Number(row.id),
        title: row.title,
        folder: row.category,
        ...(row.origin ? { from: row.origin } : {}),
        mimeType: row.mimeType ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
        text,
        characters,
        truncated,
        indexed: chunks.length > 0,
    };
}
