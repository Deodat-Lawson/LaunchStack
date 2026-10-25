/**
 * Who can see one document — the exception mechanism. An unrestricted
 * document follows its folder; a restricted one is visible only to the
 * principals in `document_grants`. No role reads past a restriction (ADR-014).
 */

import { and, eq } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { documentGrants, documentSettings } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { scopedDocumentWhere } from "~/lib/authz/scope";

import { recordActivity } from "./activity";
import { forbidden, notFound } from "./errors";
import { notifyShared } from "./notifications";
import {
    canManageDocument as canManageDocumentAccess,
    countAudience,
    loadFolderLineage,
    documentOwner,
    inheritedAudience,
    workspaceName,
    type InheritedAudience,
    type OwnerView,
} from "./item-access";
import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { copy } from "~/i18n/copy";
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

export interface DocumentAccessView {
    document: { id: number; title: string; category: string };
    restricted: boolean;
    grants: GrantView[];
    audienceCount: number;
    canManage: boolean;
    /** What "not restricted" means: its folder's audience (or the workspace's, when loose). */
    inheritsFrom: InheritedAudience & { folder: string | null };
    owner: OwnerView | null;
    workspaceName: string;
}

interface DocumentRef {
    id: number;
    title: string;
    category: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadVisibleDocument(
    ctx: WorkspaceContext,
    documentId: number
): Promise<DocumentRef> {
    const scope = await ctx.documentScope();
    const [row] = await db
        .select({ id: document.id, title: document.title, category: document.category })
        .from(document)
        .where(and(scopedDocumentWhere(ctx.companyId, scope), eq(document.id, documentId)))
        .limit(1);
    if (!row) throw notFound(copy("team.server.errors.documentNotFound"));
    return { id: Number(row.id), title: row.title, category: row.category };
}

async function documentRestricted(documentId: number): Promise<boolean> {
    const [row] = await db
        .select({ restricted: documentSettings.restricted })
        .from(documentSettings)
        .where(eq(documentSettings.documentId, BigInt(documentId)))
        .limit(1);
    return row?.restricted === true;
}

async function documentGrantRows(documentId: number): Promise<GrantRow[]> {
    const rows = await db
        .select({
            id: documentGrants.id,
            principalType: documentGrants.principalType,
            principalId: documentGrants.principalId,
            level: documentGrants.level,
        })
        .from(documentGrants)
        .where(eq(documentGrants.documentId, BigInt(documentId)));
    return rows.map(r => ({ ...r, id: Number(r.id) }));
}

/** Manage level on the document (its own grants, or its folder's when it has none of its own). */
async function canManageDocument(ctx: WorkspaceContext, doc: DocumentRef): Promise<boolean> {
    return canManageDocumentAccess(ctx, doc);
}

async function buildView(ctx: WorkspaceContext, doc: DocumentRef): Promise<DocumentAccessView> {
    const [restricted, grants, members] = await Promise.all([
        documentRestricted(doc.id),
        documentGrantRows(doc.id),
        activeMemberPrincipals(ctx.companyId),
    ]);
    const names = await principalNames(ctx.companyId, grants);
    const loose = isUnfiledFolder(doc.category);
    const [audienceCount, inherited, owner, wsName, canManage] = await Promise.all([
        // By the read rules themselves: the folder's whole lineage, the
        // document's own restriction, and anyone added to the document.
        loadFolderLineage(ctx.companyId, doc.category).then(lineage =>
            countAudience(members, lineage, { restricted, grants })
        ),
        inheritedAudience(ctx.companyId, loose ? null : normalizeFolderPath(doc.category)),
        documentOwner(doc.id),
        workspaceName(ctx.companyId),
        canManageDocument(ctx, doc),
    ]);
    return {
        document: doc,
        restricted,
        grants: toGrantViews(grants, names),
        audienceCount,
        canManage,
        inheritsFrom: { ...inherited, folder: loose ? null : normalizeFolderPath(doc.category) },
        owner,
        workspaceName: wsName,
    };
}

export async function getDocumentAccess(
    ctx: WorkspaceContext,
    documentId: number
): Promise<DocumentAccessView> {
    const doc = await loadVisibleDocument(ctx, documentId);
    return buildView(ctx, doc);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function setDocumentAccess(
    ctx: WorkspaceContext,
    documentId: number,
    input: { restricted: boolean; grants: GrantInput[] }
): Promise<DocumentAccessView> {
    const doc = await loadVisibleDocument(ctx, documentId);
    const [groupIds, existing, currentlyRestricted] = await Promise.all([
        callerGroupIds(ctx.userPk),
        documentGrantRows(doc.id),
        documentRestricted(doc.id),
    ]);

    if (!(await canManageDocument(ctx, doc))) {
        throw forbidden(copy("team.server.errors.cannotChangeDocumentAccess"));
    }

    const desired = await validatePrincipals(ctx.companyId, input.grants);
    // Restricting a document hides it from everyone not granted, the person
    // doing it included; keep a manage-level grant that reaches you.
    if (input.restricted && !hasManageGrant(ctx, groupIds, desired)) {
        throw forbidden(copy("team.server.errors.keepManageGrant"));
    }

    const diff = diffGrants(existing, desired);
    const documentKey = BigInt(doc.id);

    await db.transaction(async tx => {
        if (input.restricted !== currentlyRestricted) {
            if (input.restricted) {
                await tx
                    .insert(documentSettings)
                    .values({
                        documentId: documentKey,
                        companyId: ctx.companyId,
                        restricted: true,
                        updatedBy: ctx.authUserId,
                    })
                    .onConflictDoNothing();
            } else {
                await tx
                    .delete(documentSettings)
                    .where(eq(documentSettings.documentId, documentKey));
            }
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: input.restricted ? "document.restricted" : "document.unrestricted",
                targetType: "document",
                targetId: doc.id,
                detail: { title: doc.title },
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
            await tx.insert(documentGrants).values({
                companyId: ctx.companyId,
                documentId: documentKey,
                principalType: grant.principalType,
                principalId: grant.principalId,
                level: grant.level,
                grantedBy: ctx.authUserId,
            });
            await notifyShared(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                targetType: "document",
                targetId: doc.id,
                targetLabel: doc.title,
                level: grant.level,
                principals: [grant],
            });
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "document.grant_added",
                targetType: "document",
                targetId: doc.id,
                detail: { ...grant, principalName: principalNameOf(grant), title: doc.title },
            });
        }
        for (const change of diff.changed) {
            await tx
                .update(documentGrants)
                .set({ level: change.to })
                .where(eq(documentGrants.id, change.id));
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "document.grant_changed",
                targetType: "document",
                targetId: doc.id,
                detail: {
                    principalType: change.principalType,
                    principalId: change.principalId,
                    principalName: principalNameOf(change),
                    from: change.from,
                    to: change.to,
                    title: doc.title,
                },
            });
        }
        for (const removed of diff.removed) {
            await tx.delete(documentGrants).where(eq(documentGrants.id, removed.id));
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "document.grant_removed",
                targetType: "document",
                targetId: doc.id,
                detail: {
                    principalType: removed.principalType,
                    principalId: removed.principalId,
                    principalName: principalNameOf(removed),
                    level: removed.level,
                    title: doc.title,
                },
            });
        }

        // The team feed: one line per save, naming what changed.
        const opened = input.restricted !== currentlyRestricted && !input.restricted;
        const closed = input.restricted !== currentlyRestricted && input.restricted;
        if (opened || diff.added.length > 0 || closed || diff.removed.length > 0) {
            await recordActivity(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                verb: opened || diff.added.length > 0 ? "shared" : "unshared",
                targetType: "document",
                targetId: doc.id,
                targetLabel: doc.title,
                targetPath: doc.category,
                detail: {
                    everyone: opened,
                    restricted: closed,
                    added: diff.added.map(principalNameOf),
                    removed: diff.removed.map(principalNameOf),
                },
            });
        }
    });

    return buildView(ctx, doc);
}
