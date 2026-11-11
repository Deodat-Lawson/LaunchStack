/**
 * Shared document deletion helper.
 *
 * Extracted from /api/deleteDocument/route.ts so both single and batch delete
 * endpoints use the exact same cascade logic. Runs inside a caller-supplied
 * transaction so multi-doc batches are atomic.
 *
 * Order of operations matters: RLM tables reference each other via FKs, and
 * the final `document` row has cascading children across many tables.
 */

import { and, eq } from "drizzle-orm";
import {
    document,
    documentMetadata,
    documentPreviews,
    documentRetrievalChunks,
    documentSections,
    documentStructure,
    kgEntityMentions,
    workspaceResults,
} from "@launchstack/store/schema";
import {
    ChatHistory,
    documentReferenceResolution,
    documentViews,
    googleDrivePickedItem,
    predictiveDocumentAnalysisResults,
} from "~/server/db/schema";
import type { db as DbType } from "~/server/db";
import { rememberDeletedSource } from "~/server/services/connectors/deleted-items";
import { planDocumentDeletion } from "~/server/storage/deletion/plan";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

export interface DeleteDocumentOptions {
    readonly requestedBy: string;
    readonly reason: string;
    readonly traceId: string;
    /** Who is deleting it; recorded with a synced file so Settings can name it to them. */
    readonly deletedByUserPk?: number | null;
}

/**
 * A file picked from Google Drive on its own syncs for as long as its pick
 * does. Deleting its document is how someone stops it — it was added like an
 * upload, so it is removed like one — and the pick goes with it. A file
 * reached through a picked folder leaves the folder's pick alone: the
 * deleted-item row written alongside (rememberDeletedSource) is what keeps
 * the folder's next sync from bringing it straight back.
 */
async function forgetDrivePick(tx: Tx, metadata: Record<string, unknown> | null): Promise<void> {
    if (metadata?.connector !== "google-drive") return;
    const fileId = metadata.driveFileId;
    const connectionId = Number(metadata.connectionId);
    if (typeof fileId !== "string" || metadata.pickedRootId !== fileId) return;
    if (!Number.isSafeInteger(connectionId)) return;
    await tx
        .delete(googleDrivePickedItem)
        .where(
            and(
                eq(googleDrivePickedItem.connectionId, connectionId),
                eq(googleDrivePickedItem.fileId, fileId)
            )
        );
}

export async function deleteDocumentCore(
    tx: Tx,
    docId: number,
    options: DeleteDocumentOptions
): Promise<void> {
    const docIdBig = BigInt(docId);
    await planDocumentDeletion(tx, {
        documentIds: [docId],
        requestedBy: options.requestedBy,
        reason: options.reason,
        traceId: options.traceId,
    });

    const [row] = await tx
        .select({ title: document.title, metadata: document.ocrMetadata })
        .from(document)
        .where(eq(document.id, docId))
        .limit(1);
    if (row) {
        const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
        await forgetDrivePick(tx, metadata);
        // A synced file stays deleted: its next sync would otherwise re-import it.
        await rememberDeletedSource(tx, {
            title: row.title,
            metadata,
            deletedByUserPk: options.deletedByUserPk ?? null,
        });
    }

    await tx.delete(ChatHistory).where(eq(ChatHistory.documentId, docIdBig));
    await tx
        .delete(documentReferenceResolution)
        .where(eq(documentReferenceResolution.resolvedInDocumentId, docId));
    await tx
        .delete(predictiveDocumentAnalysisResults)
        .where(eq(predictiveDocumentAnalysisResults.documentId, docIdBig));
    await tx.delete(documentViews).where(eq(documentViews.documentId, docIdBig));

    // RLM tables — order matters: leaf tables before the tables they reference.
    // kgEntityMentions & workspaceResults & documentPreviews reference documentSections;
    // documentRetrievalChunks references documentSections and document.
    await tx.delete(kgEntityMentions).where(eq(kgEntityMentions.documentId, docIdBig));
    await tx.delete(workspaceResults).where(eq(workspaceResults.documentId, docIdBig));
    await tx.delete(documentPreviews).where(eq(documentPreviews.documentId, docIdBig));
    await tx
        .delete(documentRetrievalChunks)
        .where(eq(documentRetrievalChunks.documentId, docIdBig));
    await tx.delete(documentSections).where(eq(documentSections.documentId, docIdBig));
    await tx.delete(documentStructure).where(eq(documentStructure.documentId, docIdBig));
    await tx.delete(documentMetadata).where(eq(documentMetadata.documentId, docIdBig));

    await tx.delete(document).where(eq(document.id, docId));
}
