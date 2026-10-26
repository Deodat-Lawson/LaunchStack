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

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

/**
 * A file picked from Google Drive on its own syncs for as long as its pick
 * does. Deleting its document is how someone stops it — it was added like an
 * upload, so it is removed like one — and the pick goes with it; otherwise
 * the next sync that walks every pick (each new pick starts one) would bring
 * it straight back. A file reached through a picked folder leaves the
 * folder's pick alone.
 */
async function forgetDrivePick(tx: Tx, docId: number): Promise<void> {
    const [row] = await tx
        .select({ metadata: document.ocrMetadata })
        .from(document)
        .where(eq(document.id, docId))
        .limit(1);
    const metadata = (row?.metadata ?? null) as Record<string, unknown> | null;
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

export async function deleteDocumentCore(tx: Tx, docId: number): Promise<void> {
    const docIdBig = BigInt(docId);

    await forgetDrivePick(tx, docId);

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
