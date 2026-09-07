/**
 * Who can see one document — the exception mechanism. An unrestricted
 * document follows its folder; a restricted one is visible only to the
 * principals in `document_grants` (and to `folders.manage` holders).
 */

import { and, eq } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { documentGrants, documentSettings } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { scopedDocumentWhere } from "~/lib/authz/scope";

import { forbidden, notFound } from "./errors";
import { folderGrantRows, folderRestricted } from "./folder-access";
import {
    activeMemberPrincipals,
    callerGroupIds,
    canSeeFolder,
    canSeeRestrictedDocument,
    diffGrants,
    hasManageGrant,
    principalNames,
    toGrantViews,
    validatePrincipals,
    type GrantInput,
    type GrantRow,
    type GrantView,
    type MemberPrincipal,
} from "./grants";

export interface DocumentAccessView {
    document: { id: number; title: string; category: string };
    restricted: boolean;
    grants: GrantView[];
    audienceCount: number;
    canManage: boolean;
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
    if (!row) throw notFound("Document not found.");
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

/** An unrestricted document is seen by whoever sees its folder. */
async function folderAudience(
    companyId: bigint,
    categoryName: string,
    members: readonly MemberPrincipal[]
): Promise<number> {
    const [folder] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.companyId, companyId), eq(category.name, categoryName)))
        .limit(1);
    if (!folder) return members.filter(m => canSeeFolder(m, false, [])).length;
    const [restricted, grants] = await Promise.all([
        folderRestricted(Number(folder.id)),
        folderGrantRows(Number(folder.id)),
    ]);
    return members.filter(m => canSeeFolder(m, restricted, grants)).length;
}

function canManageDocument(
    ctx: WorkspaceContext,
    groupIds: ReadonlySet<string>,
    restricted: boolean,
    grants: readonly GrantRow[]
): boolean {
    if (ctx.can("folders.manage")) return true;
    if (!ctx.can("documents.edit")) return false;
    return restricted ? hasManageGrant(ctx, groupIds, grants) : true;
}

async function buildView(
    ctx: WorkspaceContext,
    doc: DocumentRef,
    groupIds: ReadonlySet<string>
): Promise<DocumentAccessView> {
    const [restricted, grants, members] = await Promise.all([
        documentRestricted(doc.id),
        documentGrantRows(doc.id),
        activeMemberPrincipals(ctx.companyId),
    ]);
    const names = await principalNames(ctx.companyId, grants);
    const audienceCount = restricted
        ? members.filter(m => canSeeRestrictedDocument(m, grants)).length
        : await folderAudience(ctx.companyId, doc.category, members);
    return {
        document: doc,
        restricted,
        grants: toGrantViews(grants, names),
        audienceCount,
        canManage: canManageDocument(ctx, groupIds, restricted, grants),
    };
}

export async function getDocumentAccess(
    ctx: WorkspaceContext,
    documentId: number
): Promise<DocumentAccessView> {
    const doc = await loadVisibleDocument(ctx, documentId);
    const groupIds = await callerGroupIds(ctx.userPk);
    return buildView(ctx, doc, groupIds);
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

    if (!canManageDocument(ctx, groupIds, currentlyRestricted, existing)) {
        throw forbidden("You cannot change who can see this document.");
    }

    const desired = await validatePrincipals(ctx.companyId, input.grants);
    // Restricting a document you do not manage as a folder manager would hide
    // it from you too; keep a manage-level grant that reaches you.
    if (!ctx.can("folders.manage") && input.restricted && !hasManageGrant(ctx, groupIds, desired)) {
        throw forbidden("Keep a manage-level grant for yourself, or you will lose access.");
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
    });

    return buildView(ctx, doc, groupIds);
}
