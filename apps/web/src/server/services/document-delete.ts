/**
 * Shared document deletion helper.
 *
 * Extracted from /api/deleteDocument/route.ts so both single and batch delete
 * endpoints use the exact same cascade logic. Runs inside a caller-supplied
 * transaction so multi-doc batches are atomic. Storage deletions are returned
 * to the caller and must only run after that transaction commits.
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
    documentVersions,
    fileUploads,
    kgEntityMentions,
    workspaceResults,
} from "@launchstack/store/schema";
import {
    ChatHistory,
    documentReferenceResolution,
    documentViews,
    predictiveDocumentAnalysisResults,
} from "~/server/db/schema";
import type { db as DbType } from "~/server/db";
import { parseInternalFileId } from "@launchstack/store/crypto";
import { deleteFile, deleteFileByUrl } from "~/lib/storage";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

export interface DocumentBlobDeletion {
    url: string;
    s3Key?: string;
}

/** Best-effort storage cleanup after the document transaction has committed. */
export async function deleteDocumentBlobs(deletions: DocumentBlobDeletion[]): Promise<void> {
    for (const deletion of deletions) {
        try {
            if (deletion.s3Key !== undefined) {
                await deleteFile(deletion.s3Key, "s3");
            } else {
                await deleteFileByUrl(deletion.url);
            }
        } catch (error) {
            console.error("[document-delete] Failed to delete storage blob:", deletion.url, error);
        }
    }
}

export async function deleteDocumentCore(tx: Tx, docId: number): Promise<DocumentBlobDeletion[]> {
    const docIdBig = BigInt(docId);
    // Capture all storage references before the document/version cascade
    // removes the only durable link from these uploads to their owner.
    const storedFiles = await tx
        .select({
            companyId: document.companyId,
            url: document.url,
            versionUrl: documentVersions.url,
        })
        .from(document)
        .leftJoin(documentVersions, eq(documentVersions.documentId, document.id))
        .where(eq(document.id, docId));
    const urls = new Set(storedFiles.flatMap(row => [row.url, row.versionUrl]).filter(Boolean));
    const companyId = storedFiles[0]?.companyId;

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

    if (companyId === undefined || urls.size === 0) return [];

    // Normalize surviving current and version URLs with the same parser used
    // to resolve uploads. Query strings, fragments and trailing slashes do not
    // change ownership of the underlying file.
    const references = await tx
        .select({ url: document.url, versionUrl: documentVersions.url })
        .from(document)
        .leftJoin(documentVersions, eq(documentVersions.documentId, document.id));
    const referencedUrls = new Set<string>();
    const referencedFileIds = new Set<number>();
    for (const reference of references) {
        for (const url of [reference.url, reference.versionUrl]) {
            if (!url) continue;
            referencedUrls.add(url);
            const fileId = parseInternalFileId(url);
            if (fileId !== null) referencedFileIds.add(fileId);
        }
    }

    const blobDeletions: DocumentBlobDeletion[] = [];
    const queuedBlobUrls = new Set<string>();
    for (const url of urls) {
        if (!url) continue;
        const fileId = parseInternalFileId(url);
        const uploads = await tx
            .select()
            .from(fileUploads)
            .where(
                and(
                    eq(fileUploads.companyId, companyId),
                    fileId === null ? eq(fileUploads.storageUrl, url) : eq(fileUploads.id, fileId)
                )
            );

        // An upload can be reused by another document. Deleting one owner must
        // not remove bytes that a surviving document/version still needs.
        const shared =
            referencedUrls.has(url) ||
            (fileId !== null && referencedFileIds.has(fileId)) ||
            uploads.some(
                upload =>
                    referencedFileIds.has(upload.id) ||
                    (upload.storageUrl !== null && referencedUrls.has(upload.storageUrl))
            );
        if (shared) continue;

        for (const upload of uploads) {
            if (upload.storageUrl && !queuedBlobUrls.has(upload.storageUrl)) {
                blobDeletions.push({
                    url: upload.storageUrl,
                    s3Key:
                        (upload.storageProvider === "s3" ||
                            upload.storageProvider === "seaweedfs") &&
                        upload.storagePathname
                            ? upload.storagePathname
                            : undefined,
                });
                queuedBlobUrls.add(upload.storageUrl);
            }
            // Use the caller's transaction, not deleteFile's global DB client:
            // document removal and revocation of /api/files access commit together.
            await tx.delete(fileUploads).where(eq(fileUploads.id, upload.id));
        }
        if (fileId === null && !queuedBlobUrls.has(url)) {
            blobDeletions.push({ url });
            queuedBlobUrls.add(url);
        }
    }
    return blobDeletions;
}
