/**
 * What the caller may share — the "Share something…" picker on a person's
 * page in the Team tab (ADR-014 §7).
 *
 * - **Folders** where the caller's level is `manage`, computed with the same
 *   rule the Share dialog enforces (`folderAccessFrom`) over the whole
 *   workspace's folder facts, read in three queries.
 * - **Files** with a `manage` grant that reaches the caller and that they can
 *   open — what they uploaded, or what someone handed them to run. A file in
 *   a folder they manage is shared by sharing the folder, so it is not listed
 *   on its own.
 * - **Chats** the caller owns; only the owner shares a chat.
 *
 * The picker opens the Share dialog for the chosen item, which re-checks
 * everything server-side; this list only has to be honest, not authoritative.
 */

import { and, desc, eq, inArray, or } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    documentGrants,
    folderGrants,
    folderSettings,
    workspaceSessions,
} from "~/server/db/schema";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import { folderAncestors, isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import {
    accessSubject,
    folderAccessFrom,
    levelAtLeast,
    type AccessSubject,
    type FolderFact,
    type GrantFact,
} from "../item-access";

export type ShareableType = "folder" | "document" | "chat";

export interface ShareableItem {
    type: ShareableType;
    /** Folder: category id. Document: document id. Chat: session id. */
    id: number | string;
    name: string;
    /** Folder: its path. Document: the folder it is in. */
    path?: string;
}

const DOCUMENT_LIMIT = 300;
const CHAT_LIMIT = 100;

async function manageableFolders(
    ctx: WorkspaceContext,
    subject: AccessSubject
): Promise<ShareableItem[]> {
    const [categories, settings, grants] = await Promise.all([
        db
            .select({ id: category.id, name: category.name })
            .from(category)
            .where(eq(category.companyId, ctx.companyId)),
        db
            .select({ categoryId: folderSettings.categoryId })
            .from(folderSettings)
            .where(
                and(
                    eq(folderSettings.companyId, ctx.companyId),
                    eq(folderSettings.visibility, "restricted")
                )
            ),
        db
            .select({
                categoryId: folderGrants.categoryId,
                principalType: folderGrants.principalType,
                principalId: folderGrants.principalId,
                level: folderGrants.level,
            })
            .from(folderGrants)
            .where(eq(folderGrants.companyId, ctx.companyId)),
    ]);

    // The category table has no unique (company, name); the first row wins,
    // as in `loadFolderLineage`.
    const idByPath = new Map<string, number>();
    for (const row of categories) {
        const path = normalizeFolderPath(row.name);
        if (path && !idByPath.has(path)) idByPath.set(path, Number(row.id));
    }
    const restricted = new Set(settings.map(s => Number(s.categoryId)));
    const grantsById = new Map<number, GrantFact[]>();
    for (const grant of grants) {
        const key = Number(grant.categoryId);
        const list = grantsById.get(key) ?? [];
        list.push(grant);
        grantsById.set(key, list);
    }
    const factFor = (path: string): FolderFact => {
        const categoryId = idByPath.get(path) ?? null;
        return {
            path,
            categoryId,
            restricted: categoryId !== null && restricted.has(categoryId),
            grants: categoryId === null ? [] : (grantsById.get(categoryId) ?? []),
        };
    };

    const out: ShareableItem[] = [];
    for (const [path, id] of idByPath) {
        if (isUnfiledFolder(path)) continue;
        const lineage = [path, ...folderAncestors(path).reverse()].map(factFor);
        if (levelAtLeast(folderAccessFrom(lineage, subject).level, "manage")) {
            out.push({ type: "folder", id, name: path, path });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function manageableDocuments(
    ctx: WorkspaceContext,
    subject: AccessSubject
): Promise<ShareableItem[]> {
    const principals = [
        and(
            eq(documentGrants.principalType, "user"),
            eq(documentGrants.principalId, subject.userPk)
        ),
        and(
            eq(documentGrants.principalType, "role"),
            eq(documentGrants.principalId, normalizeRoleSlug(subject.role))
        ),
    ];
    if (subject.groupIds.size > 0) {
        principals.push(
            and(
                eq(documentGrants.principalType, "group"),
                inArray(documentGrants.principalId, [...subject.groupIds])
            )
        );
    }
    const rows = await db
        .select({ id: document.id, title: document.title, category: document.category })
        .from(documentGrants)
        .innerJoin(document, eq(document.id, documentGrants.documentId))
        .where(
            and(
                eq(documentGrants.companyId, ctx.companyId),
                eq(documentGrants.level, "manage"),
                or(...principals)
            )
        )
        .orderBy(desc(document.createdAt))
        .limit(DOCUMENT_LIMIT);

    const scope = await ctx.documentScope();
    const seen = new Set<number>();
    const out: ShareableItem[] = [];
    for (const row of rows) {
        const id = Number(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!scopeAllowsDocument(scope, { id, category: row.category })) continue;
        out.push({ type: "document", id, name: row.title, path: row.category });
    }
    return out;
}

async function ownChats(ctx: WorkspaceContext): Promise<ShareableItem[]> {
    const rows = await db
        .select({ id: workspaceSessions.id, title: workspaceSessions.title })
        .from(workspaceSessions)
        .where(
            and(
                eq(workspaceSessions.companyId, ctx.companyId),
                eq(workspaceSessions.userId, ctx.authUserId)
            )
        )
        .orderBy(desc(workspaceSessions.lastMessageAt))
        .limit(CHAT_LIMIT);
    return rows.map(r => ({ type: "chat" as const, id: r.id, name: r.title }));
}

export async function listShareable(ctx: WorkspaceContext): Promise<ShareableItem[]> {
    const subject = await accessSubject(ctx);
    const [folders, documents, chats] = await Promise.all([
        manageableFolders(ctx, subject),
        manageableDocuments(ctx, subject),
        ownChats(ctx),
    ]);
    return [...folders, ...documents, ...chats];
}
