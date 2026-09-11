/**
 * DELETE /api/documents/[id]/versions/[versionId]
 *
 * Permanently remove a specific version of a document: the blob file, all
 * embeddings/structure/metadata/previews tagged with this versionId, and the
 * `document_versions` row itself.
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
 *   - The blob file is deleted from storage (Vercel Blob or SeaweedFS)
 *     _before_ the DB row is removed, so a blob deletion failure aborts the
 *     operation and leaves the DB consistent with the retained blob.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions } from "@launchstack/store/schema";
import { deleteFileByUrl } from "~/lib/storage";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";

export async function DELETE(
    request: Request,
    context: { params: Promise<{ id: string; versionId: string }> }
) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawDocId, versionId: rawVersionId } = await context.params;

            const documentId = Number(rawDocId);
            const versionId = Number(rawVersionId);
            if (!Number.isInteger(documentId) || documentId <= 0) {
                return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
            }
            if (!Number.isInteger(versionId) || versionId <= 0) {
                return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
            }

            const ctx = await requireWorkspacePermission("documents.delete");
            if (!ctx.success) return ctx.response;

            // Scoped in SQL: a cross-company or out-of-scope id reads exactly
            // like a missing document.
            const [doc] = await db
                .select()
                .from(document)
                .where(
                    and(
                        eq(document.id, documentId),
                        scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                    )
                );

            if (!doc) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }

            // Must belong to this document — prevents cross-document row deletion.
            const [targetVersion] = await db
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
                );

            if (!targetVersion) {
                return NextResponse.json(
                    { error: "Version not found for this document" },
                    { status: 404 }
                );
            }

            // Safety: cannot delete the version that the document currently points at.
            // The client must revert first.
            if (
                doc.currentVersionId !== null &&
                Number(doc.currentVersionId) === targetVersion.id
            ) {
                return NextResponse.json(
                    {
                        error: "Cannot delete the current version",
                        details:
                            "Revert the document to a different version before deleting this one.",
                    },
                    { status: 409 }
                );
            }

            // Safety: cannot delete the only remaining version. The caller should
            // delete the entire document instead — that path also cleans up things
            // this route doesn't touch (chat history, notes, graph mentions, etc.)
            const allVersions = await db
                .select({ id: documentVersions.id })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));

            if (allVersions.length <= 1) {
                return NextResponse.json(
                    {
                        error: "Cannot delete the only version of a document",
                        details:
                            "Use DELETE /api/deleteDocument to remove the entire document instead.",
                    },
                    { status: 409 }
                );
            }

            // Delete the blob first. If storage is unreachable we bail out before
            // touching the DB, leaving the system in a consistent state that can
            // be retried. A missing blob (404 from storage) is logged but does not
            // block DB cleanup — we still want the row and embeddings gone.
            try {
                await deleteFileByUrl(targetVersion.url);
            } catch (blobError) {
                console.warn(
                    `[Versions] Blob delete failed for doc=${documentId} version=${versionId} url=${targetVersion.url}:`,
                    blobError
                );
                return NextResponse.json(
                    {
                        error: "Failed to delete version blob from storage",
                        details: blobError instanceof Error ? blobError.message : String(blobError),
                    },
                    { status: 502 }
                );
            }

            // Deleting the document_versions row cascades to all RLM tables that
            // FK against it (structure, context_chunks, retrieval_chunks, metadata,
            // previews), so no manual cleanup is needed.
            await db.delete(documentVersions).where(eq(documentVersions.id, versionId));

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
                    message: "Version deleted successfully",
                },
                { status: 200 }
            );
        } catch (error) {
            console.error("[Versions] delete failed:", error);
            return NextResponse.json(
                {
                    error: "Failed to delete document version",
                    details: error instanceof Error ? error.message : String(error),
                },
                { status: 500 }
            );
        }
    });
}
