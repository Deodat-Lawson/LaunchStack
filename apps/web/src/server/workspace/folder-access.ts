/**
 * Who can see a folder. A folder is the engine `category` row; with no
 * `folder_settings` row it is visible to the whole workspace, with one it is
 * restricted to the principals in `folder_grants` (plus anyone holding
 * `folders.manage`, who sees everything anyway).
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import type { FolderVisibility } from "~/lib/authz/permissions";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import { normalizeFolderPath } from "~/lib/folders/path";
import { createFolder } from "~/server/folders";

import { forbidden, notFound } from "./errors";
import {
    activeMemberPrincipals,
    callerGroupIds,
    canSeeFolder,
    diffGrants,
    hasManageGrant,
    principalNames,
    toGrantViews,
    validatePrincipals,
    type GrantInput,
    type GrantRow,
    type GrantView,
} from "./grants";

export interface FolderAccessView {
    folder: { id: number; name: string };
    visibility: FolderVisibility;
    grants: GrantView[];
    audienceCount: number;
    canManage: boolean;
}

interface FolderRef {
    id: number;
    name: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadFolder(companyId: bigint, categoryId: number): Promise<FolderRef> {
    const [row] = await db
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.id, categoryId)))
        .limit(1);
    if (!row) throw notFound("Folder not found.");
    return { id: Number(row.id), name: row.name };
}

export async function folderRestricted(categoryId: number): Promise<boolean> {
    const [row] = await db
        .select({ visibility: folderSettings.visibility })
        .from(folderSettings)
        .where(eq(folderSettings.categoryId, BigInt(categoryId)))
        .limit(1);
    return row?.visibility === "restricted";
}

export async function folderGrantRows(categoryId: number): Promise<GrantRow[]> {
    const rows = await db
        .select({
            id: folderGrants.id,
            principalType: folderGrants.principalType,
            principalId: folderGrants.principalId,
            level: folderGrants.level,
        })
        .from(folderGrants)
        .where(eq(folderGrants.categoryId, BigInt(categoryId)));
    return rows.map(r => ({ ...r, id: Number(r.id) }));
}

/** `folders.manage`, or a manage-level grant on this folder reaching the caller. */
export async function canManageFolder(ctx: WorkspaceContext, categoryId: number): Promise<boolean> {
    if (ctx.can("folders.manage")) return true;
    const [groupIds, grants] = await Promise.all([
        callerGroupIds(ctx.userPk),
        folderGrantRows(categoryId),
    ]);
    return hasManageGrant(ctx, groupIds, grants);
}

async function requireVisibleFolder(ctx: WorkspaceContext, categoryId: number): Promise<FolderRef> {
    const folder = await loadFolder(ctx.companyId, categoryId);
    if (!ctx.can("folders.manage")) {
        const scope = await ctx.documentScope();
        if (!scopeAllowsCategory(scope, folder.name)) throw notFound("Folder not found.");
    }
    return folder;
}

async function buildView(
    ctx: WorkspaceContext,
    folder: FolderRef,
    groupIds: ReadonlySet<string>
): Promise<FolderAccessView> {
    const [restricted, grants, members] = await Promise.all([
        folderRestricted(folder.id),
        folderGrantRows(folder.id),
        activeMemberPrincipals(ctx.companyId),
    ]);
    const names = await principalNames(ctx.companyId, grants);
    return {
        folder,
        visibility: restricted ? "restricted" : "workspace",
        grants: toGrantViews(grants, names),
        audienceCount: members.filter(m => canSeeFolder(m, restricted, grants)).length,
        canManage: ctx.can("folders.manage") || hasManageGrant(ctx, groupIds, grants),
    };
}

export async function getFolderAccess(
    ctx: WorkspaceContext,
    categoryId: number
): Promise<FolderAccessView> {
    const folder = await requireVisibleFolder(ctx, categoryId);
    const groupIds = await callerGroupIds(ctx.userPk);
    return buildView(ctx, folder, groupIds);
}

async function findFolderByPath(companyId: bigint, path: string): Promise<FolderRef | null> {
    const [row] = await db
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, path)))
        .limit(1);
    return row ? { id: Number(row.id), name: row.name } : null;
}

/**
 * Folders are paths, and a folder that exists only through the documents in
 * it (or as an implied ancestor) has no `category` row yet. Reading its
 * access answers "visible to the workspace, no grants" without writing
 * anything; saving stores the row first (`folders.manage` required for that,
 * since it is the same act as creating the folder).
 */
export async function getFolderAccessByPath(
    ctx: WorkspaceContext,
    rawPath: string
): Promise<FolderAccessView> {
    const path = normalizeFolderPath(rawPath);
    const existing = await findFolderByPath(ctx.companyId, path);
    if (existing) return getFolderAccess(ctx, existing.id);

    if (!ctx.can("folders.manage")) {
        const scope = await ctx.documentScope();
        if (!scopeAllowsCategory(scope, path)) throw notFound("Folder not found.");
    }
    const members = await activeMemberPrincipals(ctx.companyId);
    return {
        folder: { id: 0, name: path },
        visibility: "workspace",
        grants: [],
        audienceCount: members.filter(m => canSeeFolder(m, false, [])).length,
        canManage: ctx.can("folders.manage"),
    };
}

export async function setFolderAccessByPath(
    ctx: WorkspaceContext,
    rawPath: string,
    input: { visibility: FolderVisibility; grants: GrantInput[] }
): Promise<FolderAccessView> {
    const path = normalizeFolderPath(rawPath);
    let folder = await findFolderByPath(ctx.companyId, path);
    if (!folder) {
        if (!ctx.can("folders.manage")) {
            throw forbidden("Only someone who can manage folders can store this folder.");
        }
        await createFolder(ctx.companyId, path);
        folder = await findFolderByPath(ctx.companyId, path);
        if (!folder) throw notFound("Folder not found.");
    }
    return setFolderAccess(ctx, folder.id, input);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function setFolderAccess(
    ctx: WorkspaceContext,
    categoryId: number,
    input: { visibility: FolderVisibility; grants: GrantInput[] }
): Promise<FolderAccessView> {
    const folder = await requireVisibleFolder(ctx, categoryId);
    const [groupIds, existing, currentlyRestricted] = await Promise.all([
        callerGroupIds(ctx.userPk),
        folderGrantRows(folder.id),
        folderRestricted(folder.id),
    ]);

    const manager = ctx.can("folders.manage");
    if (!manager && !hasManageGrant(ctx, groupIds, existing)) {
        throw forbidden("You do not manage this folder.");
    }

    const desired = await validatePrincipals(ctx.companyId, input.grants);
    if (!manager && !hasManageGrant(ctx, groupIds, desired)) {
        throw forbidden("You cannot remove your own manage access to this folder.");
    }

    const wantRestricted = input.visibility === "restricted";
    const diff = diffGrants(existing, desired);
    const categoryKey = BigInt(folder.id);

    await db.transaction(async tx => {
        if (wantRestricted !== currentlyRestricted) {
            if (wantRestricted) {
                await tx
                    .insert(folderSettings)
                    .values({
                        categoryId: categoryKey,
                        companyId: ctx.companyId,
                        visibility: "restricted",
                        updatedBy: ctx.authUserId,
                    })
                    .onConflictDoNothing();
            } else {
                await tx.delete(folderSettings).where(eq(folderSettings.categoryId, categoryKey));
            }
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "folder.visibility_changed",
                targetType: "folder",
                targetId: folder.id,
                detail: {
                    name: folder.name,
                    from: currentlyRestricted ? "restricted" : "workspace",
                    to: input.visibility,
                },
            });
        }

        // Names for the audit sentences: "gave Ada view", not "gave user 7 view".
        const auditNames = await principalNames(ctx.companyId, [
            ...diff.added,
            ...diff.changed,
            ...diff.removed,
        ]);
        const principalNameOf = (ref: { principalType: string; principalId: string }) =>
            auditNames.get(`${ref.principalType}:${ref.principalId}`) ?? ref.principalId;

        for (const grant of diff.added) {
            await tx.insert(folderGrants).values({
                companyId: ctx.companyId,
                categoryId: categoryKey,
                principalType: grant.principalType,
                principalId: grant.principalId,
                level: grant.level,
                grantedBy: ctx.authUserId,
            });
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "folder.grant_added",
                targetType: "folder",
                targetId: folder.id,
                detail: { ...grant, principalName: principalNameOf(grant), name: folder.name },
            });
        }
        for (const change of diff.changed) {
            await tx
                .update(folderGrants)
                .set({ level: change.to })
                .where(eq(folderGrants.id, change.id));
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "folder.grant_changed",
                targetType: "folder",
                targetId: folder.id,
                detail: {
                    principalType: change.principalType,
                    principalId: change.principalId,
                    principalName: principalNameOf(change),
                    from: change.from,
                    to: change.to,
                    name: folder.name,
                },
            });
        }
        for (const removed of diff.removed) {
            await tx.delete(folderGrants).where(eq(folderGrants.id, removed.id));
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "folder.grant_removed",
                targetType: "folder",
                targetId: folder.id,
                detail: {
                    principalType: removed.principalType,
                    principalId: removed.principalId,
                    principalName: principalNameOf(removed),
                    level: removed.level,
                    name: folder.name,
                },
            });
        }
    });

    return buildView(ctx, folder, groupIds);
}
