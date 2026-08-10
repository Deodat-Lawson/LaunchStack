/**
 * Data access for the internal page workspace.
 *
 * Route handlers stay thin: they authenticate, validate, and call in here.
 * Every function takes the Clerk `userId` and scopes on it — there is no code
 * path that reads or writes a page without an owner check.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
    workspaceComments,
    workspaceDatabases,
    workspacePageLinks,
    workspacePageVersions,
    workspacePages,
    type PageCover,
    type PageIcon,
    type WorkspaceComment,
    type WorkspaceDatabase,
    type WorkspacePage,
    type WorkspacePageVersion,
    type DatabaseProperty,
    type DatabaseView,
} from "~/server/db/schema/workspace";
import type {
    WorkspaceCommentDto,
    WorkspaceDatabaseDto,
    WorkspacePageDto,
    WorkspacePageSummary,
    WorkspaceSearchHit,
    WorkspaceVersionDto,
} from "~/types/workspace";

import { docPreview, docToText, extractPageLinks, type DocNode } from "./content";

/** Gap between siblings, so a drop between two of them always has room. */
const POSITION_STEP = 1024;

const iso = (value: Date | null | undefined): string | null =>
    value ? value.toISOString() : null;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializePage(row: WorkspacePage): WorkspacePageDto {
    return {
        id: row.id,
        parentPageId: row.parentPageId,
        parentType: row.parentType as WorkspacePageDto["parentType"],
        databaseId: row.databaseId,
        title: row.title,
        icon: (row.icon as PageIcon | null) ?? null,
        cover: (row.cover as PageCover | null) ?? null,
        content: row.content ?? null,
        properties: (row.properties as Record<string, unknown> | null) ?? null,
        font: row.font as WorkspacePageDto["font"],
        smallText: row.smallText,
        fullWidth: row.fullWidth,
        locked: row.locked,
        isFavorite: row.isFavorite,
        isTemplate: row.isTemplate,
        inTrash: row.inTrash,
        trashedAt: iso(row.trashedAt),
        position: row.position,
        publicSlug: row.publicSlug,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastEditedBy: row.lastEditedBy,
    };
}

export function serializeDatabase(row: WorkspaceDatabase): WorkspaceDatabaseDto {
    return {
        id: row.id,
        pageId: row.pageId,
        title: row.title,
        description: row.description,
        icon: (row.icon as PageIcon | null) ?? null,
        properties: (row.properties as DatabaseProperty[] | null) ?? [],
        views: (row.views as DatabaseView[] | null) ?? [],
        isInline: row.isInline,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function serializeComment(row: WorkspaceComment): WorkspaceCommentDto {
    return {
        id: row.id,
        pageId: row.pageId,
        blockId: row.blockId,
        anchorText: row.anchorText,
        parentCommentId: row.parentCommentId,
        authorName: row.authorName,
        authorAvatar: row.authorAvatar,
        body: row.body,
        resolved: row.resolved,
        createdAt: row.createdAt.toISOString(),
        updatedAt: iso(row.updatedAt),
    };
}

export function serializeVersion(
    row: WorkspacePageVersion,
    includeContent = false
): WorkspaceVersionDto {
    return {
        id: row.id,
        pageId: row.pageId,
        title: row.title,
        icon: (row.icon as PageIcon | null) ?? null,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        ...(includeContent ? { content: row.content ?? null } : {}),
    };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every page the user owns, as sidebar summaries. One query: the tree is
 * assembled client-side, which keeps drag-to-nest instant and avoids N+1
 * child lookups for a structure that is only ever a few hundred rows.
 */
export async function listPages(
    userId: string,
    opts: { includeTrash?: boolean } = {}
): Promise<WorkspacePageSummary[]> {
    const rows = await db
        .select({
            id: workspacePages.id,
            parentPageId: workspacePages.parentPageId,
            parentType: workspacePages.parentType,
            databaseId: workspacePages.databaseId,
            title: workspacePages.title,
            icon: workspacePages.icon,
            isFavorite: workspacePages.isFavorite,
            isTemplate: workspacePages.isTemplate,
            inTrash: workspacePages.inTrash,
            trashedAt: workspacePages.trashedAt,
            position: workspacePages.position,
            updatedAt: workspacePages.updatedAt,
        })
        .from(workspacePages)
        .where(
            opts.includeTrash
                ? eq(workspacePages.userId, userId)
                : and(eq(workspacePages.userId, userId), eq(workspacePages.inTrash, false))
        )
        .orderBy(asc(workspacePages.position), asc(workspacePages.createdAt));

    const withChildren = new Set(
        rows.map((r) => r.parentPageId).filter((id): id is string => id !== null)
    );

    return rows.map((row) => ({
        id: row.id,
        parentPageId: row.parentPageId,
        parentType: row.parentType as WorkspacePageSummary["parentType"],
        databaseId: row.databaseId,
        title: row.title,
        icon: (row.icon as PageIcon | null) ?? null,
        isFavorite: row.isFavorite,
        isTemplate: row.isTemplate,
        inTrash: row.inTrash,
        trashedAt: iso(row.trashedAt),
        position: row.position,
        hasChildren: withChildren.has(row.id),
        updatedAt: row.updatedAt.toISOString(),
    }));
}

export async function getPage(
    userId: string,
    pageId: string
): Promise<WorkspacePage | null> {
    const [row] = await db
        .select()
        .from(workspacePages)
        .where(and(eq(workspacePages.id, pageId), eq(workspacePages.userId, userId)));
    return row ?? null;
}

/** Root → page chain, used by the topbar breadcrumb. Cycle-safe. */
export async function getBreadcrumb(
    userId: string,
    pageId: string
): Promise<Array<{ id: string; title: string; icon: PageIcon | null }>> {
    const chain: Array<{ id: string; title: string; icon: PageIcon | null }> = [];
    const seen = new Set<string>();
    let cursor: string | null = pageId;

    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const [row]: Array<{
            id: string;
            title: string;
            icon: unknown;
            parentPageId: string | null;
        }> = await db
            .select({
                id: workspacePages.id,
                title: workspacePages.title,
                icon: workspacePages.icon,
                parentPageId: workspacePages.parentPageId,
            })
            .from(workspacePages)
            .where(and(eq(workspacePages.id, cursor), eq(workspacePages.userId, userId)));
        if (!row) break;
        chain.unshift({
            id: row.id,
            title: row.title,
            icon: (row.icon as PageIcon | null) ?? null,
        });
        cursor = row.parentPageId;
    }

    return chain;
}

/** Pages that link to this one, for the Backlinks section. */
export async function getBacklinks(
    userId: string,
    pageId: string
): Promise<Array<{ id: string; title: string; icon: PageIcon | null }>> {
    const rows = await db
        .select({
            id: workspacePages.id,
            title: workspacePages.title,
            icon: workspacePages.icon,
        })
        .from(workspacePageLinks)
        .innerJoin(
            workspacePages,
            eq(workspacePages.id, workspacePageLinks.sourcePageId)
        )
        .where(
            and(
                eq(workspacePageLinks.targetPageId, pageId),
                eq(workspacePageLinks.userId, userId),
                eq(workspacePages.inTrash, false)
            )
        );

    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        icon: (row.icon as PageIcon | null) ?? null,
    }));
}

/**
 * Quick Find. Title matches rank above body matches — typing a page's name
 * should surface that page, not the twelve pages that mention it.
 */
export async function searchPages(
    userId: string,
    query: string,
    limit = 25
): Promise<WorkspaceSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) {
        const recent = await db
            .select()
            .from(workspacePages)
            .where(and(eq(workspacePages.userId, userId), eq(workspacePages.inTrash, false)))
            .orderBy(desc(workspacePages.updatedAt))
            .limit(limit);
        return Promise.all(recent.map((row) => toHit(userId, row, "")));
    }

    const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const rows = await db
        .select()
        .from(workspacePages)
        .where(
            and(
                eq(workspacePages.userId, userId),
                eq(workspacePages.inTrash, false),
                or(
                    sql`${workspacePages.title} ILIKE ${pattern}`,
                    sql`${workspacePages.contentText} ILIKE ${pattern}`
                )
            )
        )
        .orderBy(
            desc(sql`(${workspacePages.title} ILIKE ${pattern})`),
            desc(workspacePages.updatedAt)
        )
        .limit(limit);

    return Promise.all(rows.map((row) => toHit(userId, row, trimmed)));
}

async function toHit(
    userId: string,
    row: WorkspacePage,
    query: string
): Promise<WorkspaceSearchHit> {
    const crumb = await getBreadcrumb(userId, row.id);
    return {
        id: row.id,
        title: row.title,
        icon: (row.icon as PageIcon | null) ?? null,
        breadcrumb: crumb.slice(0, -1).map((c) => c.title || "Untitled"),
        snippet: snippetAround(row.contentText ?? "", query),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/** A window of body text centred on the match, so the hit is visible. */
function snippetAround(text: string, query: string, radius = 70): string {
    if (!text) return "";
    if (!query) return text.slice(0, radius * 2).trim();
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at === -1) return text.slice(0, radius * 2).trim();
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + query.length + radius);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Next sort key at the end of a parent's child list. */
async function nextPosition(
    userId: string,
    parentPageId: string | null
): Promise<number> {
    const [row] = await db
        .select({ max: sql<number | null>`max(${workspacePages.position})` })
        .from(workspacePages)
        .where(
            and(
                eq(workspacePages.userId, userId),
                parentPageId === null
                    ? isNull(workspacePages.parentPageId)
                    : eq(workspacePages.parentPageId, parentPageId)
            )
        );
    return (row?.max ?? 0) + POSITION_STEP;
}

export interface CreatePageInput {
    id?: string;
    parentPageId?: string | null;
    parentType?: "workspace" | "page" | "database";
    databaseId?: string | null;
    title?: string;
    icon?: PageIcon | null;
    cover?: PageCover | null;
    content?: unknown;
    properties?: Record<string, unknown> | null;
    isTemplate?: boolean;
}

export async function createPage(
    userId: string,
    companyId: string | null,
    input: CreatePageInput
): Promise<WorkspacePage> {
    const id = input.id ?? randomUUID();
    const parentPageId = input.parentPageId ?? null;
    const content = (input.content as DocNode | null) ?? emptyDoc();

    const [row] = await db
        .insert(workspacePages)
        .values({
            id,
            userId,
            companyId,
            parentPageId,
            parentType: input.parentType ?? (parentPageId ? "page" : "workspace"),
            databaseId: input.databaseId ?? null,
            title: input.title ?? "",
            icon: input.icon ?? null,
            cover: input.cover ?? null,
            content,
            contentText: docToText(content),
            properties: input.properties ?? null,
            isTemplate: input.isTemplate ?? false,
            position: await nextPosition(userId, parentPageId),
            createdBy: userId,
            lastEditedBy: userId,
        })
        .returning();

    if (!row) throw new Error("Failed to create page");
    await syncPageLinks(userId, row.id, content);
    return row;
}

export interface UpdatePageInput {
    title?: string;
    icon?: PageIcon | null;
    cover?: PageCover | null;
    content?: unknown;
    properties?: Record<string, unknown> | null;
    font?: "default" | "serif" | "mono";
    smallText?: boolean;
    fullWidth?: boolean;
    locked?: boolean;
    isFavorite?: boolean;
    isTemplate?: boolean;
    publicSlug?: string | null;
    parentPageId?: string | null;
    parentType?: "workspace" | "page" | "database";
    position?: number;
}

export async function updatePage(
    userId: string,
    pageId: string,
    input: UpdatePageInput
): Promise<WorkspacePage | null> {
    const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        lastEditedBy: userId,
    };

    for (const key of [
        "title",
        "icon",
        "cover",
        "properties",
        "font",
        "smallText",
        "fullWidth",
        "locked",
        "isFavorite",
        "isTemplate",
        "publicSlug",
        "parentPageId",
        "parentType",
        "position",
    ] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
    }

    if (input.content !== undefined) {
        patch.content = input.content;
        patch.contentText = docToText(input.content as DocNode);
    }

    const [row] = await db
        .update(workspacePages)
        .set(patch)
        .where(and(eq(workspacePages.id, pageId), eq(workspacePages.userId, userId)))
        .returning();

    if (row && input.content !== undefined) {
        await syncPageLinks(userId, pageId, input.content as DocNode);
    }
    return row ?? null;
}

/** Ids of a page and everything beneath it, breadth-first. Cycle-safe. */
export async function collectSubtree(
    userId: string,
    rootId: string
): Promise<string[]> {
    const all = await db
        .select({
            id: workspacePages.id,
            parentPageId: workspacePages.parentPageId,
        })
        .from(workspacePages)
        .where(eq(workspacePages.userId, userId));

    const byParent = new Map<string, string[]>();
    for (const row of all) {
        if (!row.parentPageId) continue;
        const siblings = byParent.get(row.parentPageId) ?? [];
        siblings.push(row.id);
        byParent.set(row.parentPageId, siblings);
    }

    const out: string[] = [];
    const seen = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        queue.push(...(byParent.get(id) ?? []));
    }
    return out;
}

/** Move a page and its subtree to trash. Notion trashes the whole branch. */
export async function trashPage(userId: string, pageId: string): Promise<string[]> {
    const ids = await collectSubtree(userId, pageId);
    if (ids.length === 0) return [];
    await db
        .update(workspacePages)
        .set({ inTrash: true, trashedAt: new Date(), isFavorite: false })
        .where(and(eq(workspacePages.userId, userId), inArray(workspacePages.id, ids)));
    return ids;
}

/**
 * Restore from trash. If the page's parent is itself still trashed the page
 * comes back at the top level, matching Notion — a restored page is never
 * left hanging off an invisible parent.
 */
export async function restorePage(userId: string, pageId: string): Promise<string[]> {
    const ids = await collectSubtree(userId, pageId);
    if (ids.length === 0) return [];

    const [page] = await db
        .select({ parentPageId: workspacePages.parentPageId })
        .from(workspacePages)
        .where(and(eq(workspacePages.id, pageId), eq(workspacePages.userId, userId)));

    let detach = false;
    if (page?.parentPageId) {
        const [parent] = await db
            .select({ inTrash: workspacePages.inTrash })
            .from(workspacePages)
            .where(
                and(
                    eq(workspacePages.id, page.parentPageId),
                    eq(workspacePages.userId, userId)
                )
            );
        detach = !parent || parent.inTrash;
    }

    await db
        .update(workspacePages)
        .set({ inTrash: false, trashedAt: null })
        .where(and(eq(workspacePages.userId, userId), inArray(workspacePages.id, ids)));

    if (detach) {
        await db
            .update(workspacePages)
            .set({ parentPageId: null, parentType: "workspace" })
            .where(and(eq(workspacePages.id, pageId), eq(workspacePages.userId, userId)));
    }

    return ids;
}

/** Hard delete: the page, its subtree, and everything hanging off them. */
export async function deletePagePermanently(
    userId: string,
    pageId: string
): Promise<string[]> {
    const ids = await collectSubtree(userId, pageId);
    if (ids.length === 0) return [];

    await db.delete(workspaceComments).where(inArray(workspaceComments.pageId, ids));
    await db
        .delete(workspacePageVersions)
        .where(inArray(workspacePageVersions.pageId, ids));
    await db
        .delete(workspacePageLinks)
        .where(
            or(
                inArray(workspacePageLinks.sourcePageId, ids),
                inArray(workspacePageLinks.targetPageId, ids)
            )
        );
    await db.delete(workspaceDatabases).where(inArray(workspaceDatabases.pageId, ids));
    await db
        .delete(workspacePages)
        .where(and(eq(workspacePages.userId, userId), inArray(workspacePages.id, ids)));

    return ids;
}

/**
 * Deep-copy a page and its subtree. Child page nodes inside the copied body
 * are rewritten to point at the copies, so a duplicated branch is genuinely
 * independent rather than sharing children with the original.
 */
export async function duplicatePage(
    userId: string,
    companyId: string | null,
    pageId: string,
    opts: { titleSuffix?: string } = {}
): Promise<WorkspacePage | null> {
    const ids = await collectSubtree(userId, pageId);
    if (ids.length === 0) return null;

    const rows = await db
        .select()
        .from(workspacePages)
        .where(and(eq(workspacePages.userId, userId), inArray(workspacePages.id, ids)));

    const idMap = new Map<string, string>();
    for (const id of ids) idMap.set(id, randomUUID());

    const suffix = opts.titleSuffix ?? " (copy)";
    const inserts = rows.map((row) => {
        const isRoot = row.id === pageId;
        const content = remapPageIds(row.content as DocNode | null, idMap);
        return {
            id: idMap.get(row.id)!,
            userId,
            companyId,
            parentPageId: isRoot
                ? row.parentPageId
                : (idMap.get(row.parentPageId ?? "") ?? row.parentPageId),
            parentType: row.parentType,
            databaseId: row.databaseId,
            title: isRoot ? `${row.title}${suffix}` : row.title,
            icon: row.icon,
            cover: row.cover,
            content,
            contentText: docToText(content),
            properties: row.properties,
            font: row.font,
            smallText: row.smallText,
            fullWidth: row.fullWidth,
            locked: false,
            isFavorite: false,
            isTemplate: row.isTemplate,
            position: isRoot ? row.position + 1 : row.position,
            createdBy: userId,
            lastEditedBy: userId,
        };
    });

    const created = await db.insert(workspacePages).values(inserts).returning();
    for (const row of created) {
        await syncPageLinks(userId, row.id, row.content as DocNode | null);
    }
    return created.find((row) => row.id === idMap.get(pageId)) ?? null;
}

/** Rewrite `pageId` references in a copied body to point at the copies. */
function remapPageIds(
    doc: DocNode | null,
    idMap: Map<string, string>
): DocNode | null {
    if (!doc) return null;
    const clone = JSON.parse(JSON.stringify(doc)) as DocNode;

    const visit = (node: DocNode): void => {
        if (node.attrs) {
            const attrs = node.attrs;
            for (const key of ["pageId", "sourcePageId"]) {
                const current = attrs[key];
                if (typeof current === "string" && idMap.has(current)) {
                    attrs[key] = idMap.get(current)!;
                }
            }
            if (node.type === "mention" && attrs.kind === "page") {
                const current = attrs.id;
                if (typeof current === "string" && idMap.has(current)) {
                    attrs.id = idMap.get(current)!;
                }
            }
        }
        for (const mark of node.marks ?? []) {
            const href = mark.attrs?.href;
            if (typeof href === "string" && href.startsWith("page://")) {
                const target = href.slice("page://".length);
                if (idMap.has(target)) mark.attrs!.href = `page://${idMap.get(target)!}`;
            }
        }
        for (const child of node.content ?? []) visit(child);
    };

    visit(clone);
    return clone;
}

/**
 * Reposition a page among a new parent's children. Rejects a move into the
 * page's own subtree, which would orphan the branch from the root.
 */
export async function movePage(
    userId: string,
    pageId: string,
    parentPageId: string | null,
    index: number
): Promise<WorkspacePage | null> {
    if (parentPageId) {
        const subtree = await collectSubtree(userId, pageId);
        if (subtree.includes(parentPageId)) return null;
    }

    const siblings = await db
        .select({ id: workspacePages.id, position: workspacePages.position })
        .from(workspacePages)
        .where(
            and(
                eq(workspacePages.userId, userId),
                ne(workspacePages.id, pageId),
                parentPageId === null
                    ? isNull(workspacePages.parentPageId)
                    : eq(workspacePages.parentPageId, parentPageId)
            )
        )
        .orderBy(asc(workspacePages.position));

    const clamped = Math.max(0, Math.min(index, siblings.length));
    const before = siblings[clamped - 1]?.position;
    const after = siblings[clamped]?.position;

    let position: number;
    if (before === undefined && after === undefined) position = POSITION_STEP;
    else if (before === undefined) position = after! - POSITION_STEP;
    else if (after === undefined) position = before + POSITION_STEP;
    else position = (before + after) / 2;

    const [row] = await db
        .update(workspacePages)
        .set({
            parentPageId,
            parentType: parentPageId ? "page" : "workspace",
            position,
            updatedAt: new Date(),
        })
        .where(and(eq(workspacePages.id, pageId), eq(workspacePages.userId, userId)))
        .returning();

    return row ?? null;
}

// ---------------------------------------------------------------------------
// Link graph
// ---------------------------------------------------------------------------

/** Rebuild this page's outgoing links. Cheap enough to do on every save. */
export async function syncPageLinks(
    userId: string,
    pageId: string,
    doc: DocNode | null | undefined
): Promise<void> {
    const targets = extractPageLinks(doc).filter((id) => id !== pageId);

    await db
        .delete(workspacePageLinks)
        .where(eq(workspacePageLinks.sourcePageId, pageId));

    if (targets.length === 0) return;

    // Only keep links to pages that actually exist and belong to this user —
    // a dangling row would show up as a phantom backlink.
    const existing = await db
        .select({ id: workspacePages.id })
        .from(workspacePages)
        .where(
            and(eq(workspacePages.userId, userId), inArray(workspacePages.id, targets))
        );

    if (existing.length === 0) return;

    await db
        .insert(workspacePageLinks)
        .values(
            existing.map((row) => ({
                sourcePageId: pageId,
                targetPageId: row.id,
                userId,
            }))
        )
        .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** Keep the most recent N snapshots per page; older ones fall off. */
const VERSION_LIMIT = 50;

export async function snapshotPage(
    userId: string,
    page: WorkspacePage,
    label?: string
): Promise<WorkspacePageVersion | null> {
    const [row] = await db
        .insert(workspacePageVersions)
        .values({
            pageId: page.id,
            userId,
            title: page.title,
            icon: page.icon,
            content: page.content,
            label: label ?? null,
        })
        .returning();

    const stale = await db
        .select({ id: workspacePageVersions.id })
        .from(workspacePageVersions)
        .where(eq(workspacePageVersions.pageId, page.id))
        .orderBy(desc(workspacePageVersions.createdAt))
        .offset(VERSION_LIMIT);

    if (stale.length > 0) {
        await db.delete(workspacePageVersions).where(
            inArray(
                workspacePageVersions.id,
                stale.map((s) => s.id)
            )
        );
    }

    return row ?? null;
}

export async function listVersions(
    userId: string,
    pageId: string
): Promise<WorkspacePageVersion[]> {
    return db
        .select()
        .from(workspacePageVersions)
        .where(
            and(
                eq(workspacePageVersions.pageId, pageId),
                eq(workspacePageVersions.userId, userId)
            )
        )
        .orderBy(desc(workspacePageVersions.createdAt));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Thread roots with their replies nested, oldest first. */
export async function listComments(
    userId: string,
    pageId: string
): Promise<WorkspaceCommentDto[]> {
    const rows = await db
        .select()
        .from(workspaceComments)
        .where(
            and(eq(workspaceComments.pageId, pageId), eq(workspaceComments.userId, userId))
        )
        .orderBy(asc(workspaceComments.createdAt));

    const dtos = rows.map(serializeComment);
    const byId = new Map(dtos.map((c) => [c.id, { ...c, replies: [] as WorkspaceCommentDto[] }]));
    const roots: WorkspaceCommentDto[] = [];

    for (const comment of byId.values()) {
        if (comment.parentCommentId === null) {
            roots.push(comment);
            continue;
        }
        const parent = byId.get(comment.parentCommentId);
        if (parent) parent.replies.push(comment);
        else roots.push(comment);
    }

    return roots;
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

export async function getDatabase(
    userId: string,
    databaseId: string
): Promise<WorkspaceDatabase | null> {
    const [row] = await db
        .select()
        .from(workspaceDatabases)
        .where(
            and(
                eq(workspaceDatabases.id, databaseId),
                eq(workspaceDatabases.userId, userId)
            )
        );
    return row ?? null;
}

export async function listDatabaseRows(
    userId: string,
    databaseId: string
): Promise<WorkspacePage[]> {
    return db
        .select()
        .from(workspacePages)
        .where(
            and(
                eq(workspacePages.userId, userId),
                eq(workspacePages.databaseId, databaseId),
                eq(workspacePages.inTrash, false)
            )
        )
        .orderBy(asc(workspacePages.position), asc(workspacePages.createdAt));
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** An empty ProseMirror document — one paragraph, so the caret has a home. */
export function emptyDoc(): DocNode {
    return { type: "doc", content: [{ type: "paragraph" }] };
}

export const workspacePreview = docPreview;
