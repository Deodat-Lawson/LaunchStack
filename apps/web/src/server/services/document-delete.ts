/**
 * Shared document deletion helper, used by the single and batch delete
 * endpoints so both cascade the same way.
 *
 * Two halves, because object storage cannot join a database transaction:
 *
 *   `deleteDocumentCore(tx, id)` — inside the caller's transaction. The one
 *   product table without a foreign key to the document is cleared by hand;
 *   everything else is the engine's cascade (`deleteSourceCascade`): in-flight
 *   pipeline events cancelled, job rows removed, the document row deleted
 *   and ON DELETE CASCADE taking versions, chunks, embeddings, metadata,
 *   previews, graph mentions, grants, links, chat history and views.
 *
 *   `finishDocumentDelete(id, result)` — after commit. Removes the stored
 *   file of every version and the document's Neo4j footprint. Best-effort and
 *   idempotent: a failure here leaves an orphan blob to sweep, never a
 *   half-deleted document.
 *
 * Notes keep their string document id on purpose (see notes/document-scope):
 * deleting a document must never destroy the author's own notes.
 */

import { eq } from "drizzle-orm";
import { deleteSourceCascade, type DeleteSourceCascadeResult } from "@launchstack/orchestration";
import { parseInternalFileId } from "@launchstack/store/crypto";
import { documentVersions, fileUploads } from "@launchstack/store/schema";
import { documentReferenceResolution } from "~/server/db/schema";
import { db, type db as DbType } from "~/server/db";
import { deleteFileByUrl } from "~/lib/storage";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

export type DocumentDeleteResult = DeleteSourceCascadeResult;

export async function deleteDocumentCore(tx: Tx, docId: number): Promise<DocumentDeleteResult> {
    // `resolved_in_document_id` is a plain column, not a foreign key, so the
    // cascade cannot reach it.
    await tx
        .delete(documentReferenceResolution)
        .where(eq(documentReferenceResolution.resolvedInDocumentId, docId));

    return deleteSourceCascade(tx, docId);
}

export interface DocumentDeleteCleanup {
    filesDeleted: number;
    filesFailed: number;
    graphSections: number;
}

/**
 * The after-commit half: stored files and the graph. Safe to call again for
 * the same document; every step tolerates the thing being already gone.
 */
export async function finishDocumentDelete(
    docId: number,
    result: DocumentDeleteResult
): Promise<DocumentDeleteCleanup> {
    let filesDeleted = 0;
    let filesFailed = 0;

    for (const url of result.blobUrls) {
        try {
            const fileId = parseInternalFileId(url);
            if (fileId !== null) {
                // Database-backed storage: the file_uploads row IS the file.
                // Another document's version may still point at the same row
                // (a published mindmap re-indexed in place, for one), so it
                // only goes when nothing references it any more.
                const [stillUsed] = await db
                    .select({ id: documentVersions.id })
                    .from(documentVersions)
                    .where(eq(documentVersions.url, url))
                    .limit(1);
                if (stillUsed) continue;
                await db.delete(fileUploads).where(eq(fileUploads.id, fileId));
            } else {
                await deleteFileByUrl(url);
            }
            filesDeleted += 1;
        } catch (error) {
            filesFailed += 1;
            console.warn(
                `[DocumentDelete] Stored file cleanup failed for document ${docId} (${url}):`,
                error instanceof Error ? error.message : error
            );
        }
    }

    let graphSections = 0;
    try {
        const { isNeo4jConfigured, deleteDocumentFromNeo4j } = await import(
            "@launchstack/indexing/knowledge-graph"
        );
        if (isNeo4jConfigured()) {
            graphSections = (await deleteDocumentFromNeo4j(docId)).sections;
        }
    } catch (error) {
        console.warn(
            `[DocumentDelete] Graph cleanup failed for document ${docId}:`,
            error instanceof Error ? error.message : error
        );
    }

    return { filesDeleted, filesFailed, graphSections };
}
