/**
 * Data access for the Mindmap app.
 *
 * Every read is scoped by `companyId` here rather than in the route handlers,
 * so a missing `where` clause cannot leak another workspace's diagrams. Routes
 * pass the `WorkspaceContext` they already resolved and get back either the
 * row or `null`.
 */

import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmapRevisions, mindmaps, type Mindmap } from "~/server/db/schema";

/** How many history snapshots to keep per document. */
export const REVISION_LIMIT = 60;

/** How much flattened label text a list row carries for client-side search. */
const SUMMARY_SEARCH_TEXT_LIMIT = 2000;

export interface MindmapSummary {
    id: number;
    title: string;
    description: string | null;
    folder: string;
    templateId: string | null;
    /**
     * The PNG data URI, when the caller asked for it. List responses leave it
     * null and set `hasThumbnail` instead — see `/api/mindmaps/[id]/thumbnail`.
     */
    thumbnail: string | null;
    hasThumbnail: boolean;
    nodeCount: number;
    edgeCount: number;
    revision: number;
    starred: boolean;
    publishedDocumentId: number | null;
    publishedAt: string | null;
    /** Revision the published copy was made from; null when never published. */
    publishedRevision: number | null;
    /**
     * Node and edge labels, flattened and capped, so the workspace's search
     * boxes can match a map by what is drawn on it. The full text stays on
     * the row for the server-side search.
     */
    searchText: string | null;
    createdByUserId: string;
    updatedByUserId: string | null;
    deletedAt: string | null;
    openedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface MindmapDetail extends MindmapSummary {
    doc: unknown;
    docVersion: number;
}

function iso(value: Date | string | null): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toSummary(row: Mindmap): MindmapSummary {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        folder: row.folder,
        templateId: row.templateId,
        thumbnail: row.thumbnail,
        hasThumbnail: typeof row.thumbnail === "string" && row.thumbnail.length > 0,
        nodeCount: row.nodeCount,
        edgeCount: row.edgeCount,
        revision: row.revision,
        starred: row.starred,
        publishedDocumentId:
            row.publishedDocumentId === null ? null : Number(row.publishedDocumentId),
        publishedAt: iso(row.publishedAt),
        publishedRevision: row.publishedRevision,
        searchText: row.searchText ? row.searchText.slice(0, SUMMARY_SEARCH_TEXT_LIMIT) : null,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        deletedAt: iso(row.deletedAt),
        openedAt: iso(row.openedAt),
        createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
        updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    };
}

export function toDetail(row: Mindmap): MindmapDetail {
    return { ...toSummary(row), doc: row.doc, docVersion: row.docVersion };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListFilters {
    companyId: bigint;
    /** `active` hides trashed maps; `trash` shows only those. */
    scope?: "active" | "trash";
    folder?: string;
    search?: string;
    starredOnly?: boolean;
    /** Only maps this user created. */
    createdByUserId?: string;
    limit?: number;
}

export async function listMindmaps(filters: ListFilters): Promise<MindmapSummary[]> {
    const conditions = [eq(mindmaps.companyId, filters.companyId)];

    conditions.push(
        filters.scope === "trash" ? isNotNull(mindmaps.deletedAt) : isNull(mindmaps.deletedAt)
    );
    if (filters.folder) conditions.push(eq(mindmaps.folder, filters.folder));
    if (filters.starredOnly) conditions.push(eq(mindmaps.starred, true));
    if (filters.createdByUserId) {
        conditions.push(eq(mindmaps.createdByUserId, filters.createdByUserId));
    }
    if (filters.search) {
        const needle = `%${filters.search}%`;
        // Title first so a name match is cheap; the flattened node text catches
        // "that map with the Postgres box in it".
        conditions.push(or(ilike(mindmaps.title, needle), ilike(mindmaps.searchText, needle))!);
    }

    const rows = await db
        .select()
        .from(mindmaps)
        .where(and(...conditions))
        .orderBy(desc(mindmaps.updatedAt))
        .limit(Math.min(filters.limit ?? 200, 500));

    return rows.map(toSummary);
}

export async function getMindmap(id: number, companyId: bigint): Promise<Mindmap | null> {
    const [row] = await db
        .select()
        .from(mindmaps)
        .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, companyId)))
        .limit(1);
    return row ?? null;
}

export async function listFolders(companyId: bigint): Promise<string[]> {
    const rows = await db
        .selectDistinct({ folder: mindmaps.folder })
        .from(mindmaps)
        .where(and(eq(mindmaps.companyId, companyId), isNull(mindmaps.deletedAt)));
    return rows.map(r => r.folder).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export async function writeRevision(input: {
    mindmapId: number;
    revision: number;
    doc: unknown;
    authorUserId: string;
    label?: string;
    nodeCount: number;
}): Promise<void> {
    await db.insert(mindmapRevisions).values({
        mindmapId: input.mindmapId,
        revision: input.revision,
        doc: input.doc,
        authorUserId: input.authorUserId,
        label: input.label ?? null,
        nodeCount: input.nodeCount,
    });

    // Keep the tail bounded. A single DELETE with a subquery beats reading the
    // ids back, and history is advisory — a trimmed snapshot is never the one
    // the user is restoring from in practice.
    await db.execute(sql`
        DELETE FROM ${mindmapRevisions}
        WHERE ${mindmapRevisions.mindmapId} = ${input.mindmapId}
          AND ${mindmapRevisions.id} NOT IN (
            SELECT id FROM ${mindmapRevisions}
            WHERE ${mindmapRevisions.mindmapId} = ${input.mindmapId}
            ORDER BY ${mindmapRevisions.revision} DESC
            LIMIT ${REVISION_LIMIT}
          )
    `);
}

export interface RevisionSummary {
    id: number;
    revision: number;
    label: string | null;
    authorUserId: string | null;
    nodeCount: number;
    createdAt: string;
}

export async function listRevisions(mindmapId: number): Promise<RevisionSummary[]> {
    const rows = await db
        .select({
            id: mindmapRevisions.id,
            revision: mindmapRevisions.revision,
            label: mindmapRevisions.label,
            authorUserId: mindmapRevisions.authorUserId,
            nodeCount: mindmapRevisions.nodeCount,
            createdAt: mindmapRevisions.createdAt,
        })
        .from(mindmapRevisions)
        .where(eq(mindmapRevisions.mindmapId, mindmapId))
        .orderBy(desc(mindmapRevisions.revision))
        .limit(REVISION_LIMIT);

    return rows.map(r => ({
        id: r.id,
        revision: r.revision,
        label: r.label,
        authorUserId: r.authorUserId,
        nodeCount: r.nodeCount,
        createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
    }));
}

export async function getRevision(
    mindmapId: number,
    revisionId: number
): Promise<{ doc: unknown; revision: number } | null> {
    const [row] = await db
        .select({ doc: mindmapRevisions.doc, revision: mindmapRevisions.revision })
        .from(mindmapRevisions)
        .where(and(eq(mindmapRevisions.id, revisionId), eq(mindmapRevisions.mindmapId, mindmapId)))
        .limit(1);
    return row ?? null;
}

// ---------------------------------------------------------------------------
// Document statistics
// ---------------------------------------------------------------------------

export interface DocStats {
    nodeCount: number;
    edgeCount: number;
    searchText: string;
}

/**
 * Count shapes and flatten label text out of an untrusted `doc` payload.
 * Deliberately defensive: the column values are only ever used for the list
 * view and search, so a malformed page must degrade to zero, never throw.
 */
export function summariseDoc(doc: unknown): DocStats {
    let nodeCount = 0;
    let edgeCount = 0;
    const words: string[] = [];

    const record = doc as { title?: unknown; pages?: unknown } | null;
    if (record && typeof record === "object") {
        if (typeof record.title === "string") words.push(record.title);
        const pages = Array.isArray(record.pages) ? record.pages : [];
        for (const page of pages) {
            if (!page || typeof page !== "object") continue;
            const p = page as { nodes?: unknown; edges?: unknown; name?: unknown };
            if (typeof p.name === "string") words.push(p.name);
            if (Array.isArray(p.nodes)) {
                nodeCount += p.nodes.length;
                for (const nd of p.nodes) {
                    const text = (nd as { text?: unknown })?.text;
                    if (typeof text === "string" && text.trim()) words.push(text);
                }
            }
            if (Array.isArray(p.edges)) {
                edgeCount += p.edges.length;
                for (const e of p.edges) {
                    const labels = (e as { labels?: unknown })?.labels;
                    if (!Array.isArray(labels)) continue;
                    for (const l of labels) {
                        const text = (l as { text?: unknown })?.text;
                        if (typeof text === "string" && text.trim()) words.push(text);
                    }
                }
            }
        }
    }

    // Cap the indexed text: `search_text` exists for ILIKE, not for retrieval,
    // and a 10k-node map would otherwise write megabytes on every save.
    return { nodeCount, edgeCount, searchText: words.join(" · ").slice(0, 20000) };
}
