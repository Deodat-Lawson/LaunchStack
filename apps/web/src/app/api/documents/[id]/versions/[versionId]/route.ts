/**
 * DELETE /api/documents/[id]/versions/[versionId]
 *
 * Permanently remove a version and its relational children, with durable
 * storage cleanup scheduled in the same transaction.
 *
 * Safety rules:
 *   - Cannot delete the current version. Callers must revert to a different
 *     version first (avoids leaving a document pointing at a dead row).
 *   - Cannot delete the only remaining version of a document. Use the full
 *     `DELETE /api/deleteDocument` flow instead if you want to remove
 *     the whole document.
 *
 * Cascade behavior:
 *   - `document_structure`, `document_context_chunks`, `document_retrieval_chunks`,
 *     `document_metadata`, and `document_previews` all have `version_id` FKs
 *     with `ON DELETE CASCADE`, so deleting the `document_versions` row
 *     automatically removes all embeddings tied to it — no manual cleanup.
 *   - Stored objects are snapshotted before removing the row and cleaned up
 *     asynchronously through the transactional outbox.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions, ocrJobs } from "@launchstack/store/schema";
import { planVersionDeletion } from "~/server/storage/deletion/plan";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { canEditDocument } from "~/server/workspace/item-access";

export async function DELETE(
    request: Request,
    context: { params: Promise<{ id: string; versionId: string }> }
) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.versions");
    const s = translatorFor(locale, "sources.server.errors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawDocId, versionId: rawVersionId } = await context.params;

            const documentId = Number(rawDocId);
            const versionId = Number(rawVersionId);
            if (!Number.isInteger(documentId) || documentId <= 0) {
                return NextResponse.json({ error: s("invalidDocumentId") }, { status: 400 });
            }
            if (!Number.isInteger(versionId) || versionId <= 0) {
                return NextResponse.json({ error: t("invalidVersionId") }, { status: 400 });
            }

            const ctx = await requireWorkspacePermission("documents.delete");
            if (!ctx.success) return ctx.response;

            const scope = await ctx.data.documentScope();
            // Resolve item permissions before holding database locks.
            const [editableDoc] = await db
                .select()
                .from(document)
                .where(
                    and(eq(document.id, documentId), scopedDocumentWhere(ctx.data.companyId, scope))
                );
            if (!editableDoc) {
                return NextResponse.json(
                    { error: translatorFor(locale, "errors.api")("documentNotFound") },
                    { status: 404 }
                );
            }
            if (
                !(await canEditDocument(ctx.data, {
                    id: documentId,
                    category: editableDoc.category,
                }))
            ) {
                return NextResponse.json({ error: s("documentEditDenied") }, { status: 403 });
            }
            return await db.transaction(async tx => {
                // Scoped in SQL: a cross-company or out-of-scope id reads exactly
                // like a missing document.
                const [doc] = await tx
                    .select()
                    .from(document)
                    .where(
                        and(
                            eq(document.id, documentId),
                            scopedDocumentWhere(ctx.data.companyId, scope)
                        )
                    )
                    .for("update");

                if (!doc) {
                    return NextResponse.json(
                        { error: translatorFor(locale, "errors.api")("documentNotFound") },
                        { status: 404 }
                    );
                }

                // Must belong to this document — prevents cross-document row deletion.
                const [targetVersion] = await tx
                    .select({
                        id: documentVersions.id,
                        versionNumber: documentVersions.versionNumber,
                        url: documentVersions.url,
                    })
                    .from(documentVersions)
                    .where(
                        and(
                            eq(documentVersions.id, versionId),
                            eq(documentVersions.documentId, BigInt(documentId))
                        )
                    )
                    .for("update");

                if (!targetVersion) {
                    return NextResponse.json({ error: t("versionNotFound") }, { status: 404 });
                }

                // Safety: cannot delete the version that the document currently points at.
                // The client must revert first.
                if (
                    doc.currentVersionId !== null &&
                    Number(doc.currentVersionId) === targetVersion.id
                ) {
                    return NextResponse.json(
                        {
                            error: t("cannotDeleteCurrent"),
                            details: t("cannotDeleteCurrentDetail"),
                        },
                        { status: 409 }
                    );
                }

                // Safety: cannot delete the only remaining version. The caller should
                // delete the entire document instead — that path also cleans up things
                // this route doesn't touch (chat history, notes, graph mentions, etc.)
                const allVersions = await tx
                    .select({ id: documentVersions.id })
                    .from(documentVersions)
                    .where(eq(documentVersions.documentId, BigInt(documentId)))
                    .for("update");

                if (allVersions.length <= 1) {
                    return NextResponse.json(
                        {
                            error: t("cannotDeleteOnly"),
                            details: t("cannotDeleteOnlyDetail"),
                        },
                        { status: 409 }
                    );
                }

                await planVersionDeletion(tx, {
                    documentId,
                    versionId,
                    requestedBy: ctx.data.authUserId,
                    reason: "version_delete",
                    traceId: randomUUID(),
                });
                // Jobs are not version-cascaded; remove their reference only after
                // the planner has snapshotted any processing URL they own.
                await tx.delete(ocrJobs).where(eq(ocrJobs.versionId, BigInt(versionId)));

                // Deleting the document_versions row cascades to all RLM tables that
                // FK against it (structure, context_chunks, retrieval_chunks, metadata,
                // previews), so no manual cleanup is needed.
                await tx.delete(documentVersions).where(eq(documentVersions.id, versionId));

                console.log(
                    `[Versions] Deleted doc=${documentId} v${targetVersion.versionNumber} ` +
                        `(versionId=${targetVersion.id}) by user=${ctx.data.authUserId}`
                );

                return NextResponse.json(
                    {
                        success: true,
                        documentId,
                        versionId: targetVersion.id,
                        versionNumber: targetVersion.versionNumber,
                        message: t("deleted"),
                    },
                    { status: 200 }
                );
            });
        } catch (error) {
            console.error("[Versions] delete failed:", error);
            return NextResponse.json(
                {
                    error: t("deleteFailed"),
                    details: error instanceof Error ? error.message : String(error),
                },
                { status: 500 }
            );
        }
    });
}
