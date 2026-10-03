/**
 * Who can see a folder. A folder is the engine `category` row; with no
 * `folder_settings` row it follows its parent (workspace-wide at the top),
 * with one it is restricted to the principals in `folder_grants`. Changing
 * that needs manage level on the folder (`~/server/workspace/item-access`):
 * a grant on it or its governing folder, or `folders.manage` while nothing
 * above restricts it. No role reads or manages past a restriction (ADR-014).
 */

import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { folderGrants, folderSettings } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import type { FolderVisibility } from "~/lib/authz/permissions";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import { folderParentPath, normalizeFolderPath } from "~/lib/folders/path";
import { createFolder } from "~/server/folders";

import {
    canManageFolderPath,
    countAudience,
    folderAccess,
    loadFolderLineage,
    folderOwner,
    inheritedAudience,
    workspaceName,
    type InheritedAudience,
    type OwnerView,
} from "./item-access";

import { recordActivity } from "./activity";
import { forbidden, notFound } from "./errors";
import { notifyShared } from "./notifications";
import {
    activeMemberPrincipals,
    callerGroupIds,
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
    /** `restricted` only when the folder has its own audience; inheriting reads `workspace`. */
    visibility: FolderVisibility;
    grants: GrantView[];
    audienceCount: number;
    canManage: boolean;
    /** What "not restricted" means here: the workspace, or the restricted folder above. */
    inheritsFrom: InheritedAudience;
    /** Who made it (null for folders from before ADR-014). */
    owner: OwnerView | null;
    workspaceName: string;
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

/** Manage level on this folder: a grant on it or its governing folder, or `folders.manage` when nothing restricts it. */
export async function canManageFolder(ctx: WorkspaceContext, categoryId: number): Promise<boolean> {
    const folder = await loadFolder(ctx.companyId, categoryId);
    return canManageFolderPath(ctx, folder.name);
}

async function requireVisibleFolder(ctx: WorkspaceContext, categoryId: number): Promise<FolderRef> {
    const folder = await loadFolder(ctx.companyId, categoryId);
    const scope = await ctx.documentScope();
    if (!scopeAllowsCategory(scope, folder.name)) throw notFound("Folder not found.");
    return folder;
}

async function buildView(ctx: WorkspaceContext, folder: FolderRef): Promise<FolderAccessView> {
    const [restricted, grants, members, inheritsFrom, owner, wsName, access] = await Promise.all([
        folderRestricted(folder.id),
        folderGrantRows(folder.id),
        activeMemberPrincipals(ctx.companyId),
        inheritedAudience(ctx.companyId, folderParentPath(folder.name)),
        folderOwner(folder.id),
        workspaceName(ctx.companyId),
        folderAccess(ctx, folder.name),
    ]);
    const names = await principalNames(ctx.companyId, grants);
    // By the read rules themselves: an inheriting folder is seen by whoever
    // sees the folder it inherits from, plus anyone added to it directly.
    const audienceCount = countAudience(
        members,
        await loadFolderLineage(ctx.companyId, folder.name)
    );
    return {
        folder,
        visibility: restricted ? "restricted" : "workspace",
        grants: toGrantViews(grants, names),
        audienceCount,
        canManage: access.level === "manage",
        inheritsFrom,
        owner,
        workspaceName: wsName,
    };
}

export async function getFolderAccess(
    ctx: WorkspaceContext,
    categoryId: number
): Promise<FolderAccessView> {
    const folder = await requireVisibleFolder(ctx, categoryId);
    return buildView(ctx, folder);
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

    const scope = await ctx.documentScope();
    if (!scopeAllowsCategory(scope, path)) throw notFound("Folder not found.");
    const [members, inheritsFrom, wsName, access, lineage] = await Promise.all([
        activeMemberPrincipals(ctx.companyId),
        inheritedAudience(ctx.companyId, folderParentPath(path)),
        workspaceName(ctx.companyId),
        folderAccess(ctx, path),
        loadFolderLineage(ctx.companyId, path),
    ]);
    return {
        folder: { id: 0, name: path },
        visibility: "workspace",
        grants: [],
        // Implied inside a restricted folder, it is seen by that folder's
        // audience — not the whole workspace.
        audienceCount: countAudience(members, lineage),
        canManage: access.level === "manage",
        inheritsFrom,
        owner: null,
        workspaceName: wsName,
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
        if (!(await canManageFolderPath(ctx, path))) {
            throw forbidden("You do not manage this folder.");
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

    if (!(await canManageFolderPath(ctx, folder.name))) {
        throw forbidden("You do not manage this folder.");
    }

    const desired = await validatePrincipals(ctx.companyId, input.grants);
    const wantRestricted = input.visibility === "restricted";
    // Restricting a folder hides it from everyone not granted — the person
    // doing it included, since no role reads past a restriction.
    if (wantRestricted && !hasManageGrant(ctx, groupIds, desired)) {
        throw forbidden("Keep a manage-level grant for yourself, or you will lose access.");
    }

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
            await notifyShared(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                targetType: "folder",
                targetId: folder.id,
                targetLabel: folder.name,
                targetPath: folder.name,
                level: grant.level,
                principals: [grant],
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

        // The team feed: one line per save, naming what changed.
        const opened = wantRestricted !== currentlyRestricted && !wantRestricted;
        const closed = wantRestricted !== currentlyRestricted && wantRestricted;
        if (opened || diff.added.length > 0 || closed || diff.removed.length > 0) {
            await recordActivity(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                verb: opened || diff.added.length > 0 ? "shared" : "unshared",
                targetType: "folder",
                targetId: folder.id,
                targetLabel: folder.name,
                targetPath: folder.name,
                detail: {
                    everyone: opened,
                    restricted: closed,
                    added: diff.added.map(principalNameOf),
                    removed: diff.removed.map(principalNameOf),
                },
            });
        }
    });

    return buildView(ctx, folder);
}
