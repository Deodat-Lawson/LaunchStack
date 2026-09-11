/**
 * The post-retrieval gate: the last check before a retrieved chunk reaches
 * a prompt.
 *
 * Every retrieval leg filters by the caller's scope in SQL, so this should
 * drop nothing. It exists so a leg that forgets — a new retriever, a raw
 * query that skips the `document` join — fails loudly instead of leaking:
 * each dropped chunk is counted in `authz_retrieval_dropped_total` and
 * logged. Chunks that carry `metadata.category` are checked in memory; the
 * rest cost one scoped lookup for their distinct document ids.
 */

import { and, inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { scopeAllowsDocument, type DocumentScope } from "~/lib/authz/scope-types";
import { db } from "~/server/db";
import { recordRetrievalDropped } from "~/server/metrics/authz";

export interface GateableChunk {
    metadata?:
        | {
              documentId?: unknown;
              category?: unknown;
              chunkId?: unknown;
              source?: unknown;
          }
        | undefined;
}

export interface GateOptions {
    companyId: bigint;
    scope: DocumentScope;
    /** The request's search scope, for the metric label and the log line. */
    searchScope: string;
}

/** Notes carry the id as a string; freeform notes carry none. */
function chunkDocumentId(chunk: GateableChunk): number | null {
    const raw = chunk.metadata?.documentId;
    if (raw === null || raw === undefined || raw === "") return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
}

function chunkCategory(chunk: GateableChunk): string | undefined {
    const raw = chunk.metadata?.category;
    return typeof raw === "string" ? raw : undefined;
}

export async function gateChunksByScope<T extends GateableChunk>(
    chunks: T[],
    { companyId, scope, searchScope }: GateOptions
): Promise<T[]> {
    if (chunks.length === 0 || scope.kind === "everything") return chunks;

    const unknown = new Set<number>();
    for (const chunk of chunks) {
        const id = chunkDocumentId(chunk);
        if (id !== null && chunkCategory(chunk) === undefined) unknown.add(id);
    }

    const categories = new Map<number, string>();
    if (unknown.size > 0) {
        const rows = await db
            .select({ id: document.id, category: document.category })
            .from(document)
            .where(and(inArray(document.id, [...unknown]), scopedDocumentWhere(companyId, scope)));
        for (const row of rows) categories.set(Number(row.id), row.category);
    }

    const kept: T[] = [];
    let dropped = 0;
    for (const chunk of chunks) {
        const id = chunkDocumentId(chunk);
        if (id === null) {
            // A freeform note: no document to gate on.
            kept.push(chunk);
            continue;
        }
        // A document the scoped lookup did not return is out of scope or gone;
        // either way the chunk must not be used.
        const category = chunkCategory(chunk) ?? categories.get(id);
        if (category !== undefined && scopeAllowsDocument(scope, { id, category })) {
            kept.push(chunk);
            continue;
        }
        dropped += 1;
        console.warn("[authz] retrieval leg returned out-of-scope chunk", {
            searchScope,
            documentId: id,
            chunkId: chunk.metadata?.chunkId,
            source: chunk.metadata?.source,
        });
    }

    recordRetrievalDropped(searchScope, dropped);
    return kept;
}
