/**
 * Cascade deletion of a source: the counterpart to transactional acceptance
 * in `lifecycle.ts`. Everything acceptance and the pipeline created for a
 * document goes in one transaction, and everything still in flight for it
 * is cancelled so the worker never runs against a row that is gone.
 *
 * Inside the caller's transaction:
 *   1. the source's `pending` / `processing` outbox events → `cancelled`;
 *      a worker mid-handler finds its row no longer `processing` and
 *      discards its outcome (see OutboxStorePort), and a stage that reads
 *      the deleted rows throws `SourceGoneError`, which the tick
 *      dead-letters on the first attempt;
 *   2. the source's `ocr_jobs` rows are deleted — they carry the extracted
 *      pages and the FK would only null them out into orphans;
 *   3. the document row is deleted, and ON DELETE CASCADE takes versions,
 *      structure, context and retrieval chunks, per-dimension embeddings,
 *      metadata, previews, KG mentions, workspace results, grants, drive
 *      links, settings, chat history and views.
 *
 * Object storage is not transactional, so the blob URL of every version is
 * returned for the caller to delete after commit (the web app's
 * document-delete service does this). Notes keep their string document id
 * on purpose — a deleted document must never destroy the author's notes.
 */
import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";
import { document, documentVersions, eventOutbox, ocrJobs } from "@launchstack/store/schema";

/** The transaction (or client) the cascade runs in. */
export type DeleteSourceExecutor = Pick<DbClient, "select" | "delete" | "execute">;

export interface DeleteSourceCascadeResult {
    /** False when no document with that id existed; nothing was touched. */
    found: boolean;
    /** Every distinct stored-file URL the document and its versions pointed at. */
    blobUrls: string[];
    cancelledEvents: number;
    deletedJobs: number;
    deletedVersions: number;
}

/** `last_error` stamped on events cancelled by a delete, for the runbook's queries. */
export const CANCELLED_BY_DELETE = "cancelled: source deleted";

export async function deleteSourceCascade(
    tx: DeleteSourceExecutor,
    sourceId: number
): Promise<DeleteSourceCascadeResult> {
    const docId = BigInt(sourceId);

    const [doc] = await tx
        .select({ url: document.url, companyId: document.companyId })
        .from(document)
        .where(eq(document.id, sourceId))
        .limit(1);
    if (!doc) {
        return {
            found: false,
            blobUrls: [],
            cancelledEvents: 0,
            deletedJobs: 0,
            deletedVersions: 0,
        };
    }

    // Collected before the row goes: after the cascade there is nothing left
    // to read the URLs from.
    const versions = await tx
        .select({ url: documentVersions.url })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, docId));
    const blobUrls = [...new Set([doc.url, ...versions.map(v => v.url)].filter(u => u.length > 0))];

    // The outbox row stores the whole event envelope, so the source id sits
    // under the envelope's own `payload` key. Scoped by company first: the
    // company index makes this a short scan even on a busy outbox.
    const cancelled = await tx.execute(sql`
        UPDATE ${eventOutbox}
        SET status = 'cancelled',
            last_error = ${CANCELLED_BY_DELETE},
            claimed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = ${Number(doc.companyId)}
          AND status IN ('pending', 'processing')
          AND (payload -> 'payload' ->> 'sourceId') = ${String(sourceId)}
        RETURNING id
    `);

    const jobs = await tx
        .delete(ocrJobs)
        .where(eq(ocrJobs.documentId, docId))
        .returning({ id: ocrJobs.id });

    await tx.delete(document).where(eq(document.id, sourceId));

    return {
        found: true,
        blobUrls,
        cancelledEvents: (cancelled as unknown as unknown[]).length,
        deletedJobs: jobs.length,
        deletedVersions: versions.length,
    };
}
