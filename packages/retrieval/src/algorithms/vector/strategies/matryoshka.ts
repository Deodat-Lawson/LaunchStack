/**
 * Matryoshka coarse-to-fine: use 512-dim short embeddings from
 * `document_retrieval_chunks` (HNSW-indexed) for fast candidate filtering,
 * then re-rank the top candidates with full-dimension embeddings. Page
 * numbers resolve through the candidates' context chunks. Falls back to the
 * exact scan when the short-vector pass returns nothing.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentRetrievalChunks, documentSections } from "@launchstack/store/schema";
import type { ANNResult } from "../../../search-types";
import { exactScanSearch } from "./exact";
import { sanitizeErrorMessage } from "./sanitize";

export async function matryoshkaSearch(
    queryEmbedding: number[],
    documentIds: number[],
    limit: number,
    threshold: number
): Promise<ANNResult[]> {
    try {
        const shortDim = 512;
        const queryShort = queryEmbedding.slice(0, shortDim);
        const shortStr = `[${queryShort.join(",")}]`;

        const coarseCandidateCount = Math.min(limit * 6, 120);

        const coarseResults = await getDb()
            .select({
                id: documentRetrievalChunks.id,
                content: documentRetrievalChunks.content,
                documentId: documentRetrievalChunks.documentId,
                contextChunkId: documentRetrievalChunks.contextChunkId,
                shortDistance: sql<number>`${documentRetrievalChunks.embeddingShort} <=> ${shortStr}::vector`,
            })
            .from(documentRetrievalChunks)
            .innerJoin(document, eq(documentRetrievalChunks.documentId, document.id))
            .where(
                and(
                    inArray(
                        documentRetrievalChunks.documentId,
                        documentIds.map(id => BigInt(id))
                    ),
                    eq(documentRetrievalChunks.versionId, document.currentVersionId)
                )
            )
            .orderBy(sql`${documentRetrievalChunks.embeddingShort} <=> ${shortStr}::vector`)
            .limit(coarseCandidateCount);

        if (coarseResults.length === 0) {
            return exactScanSearch(queryEmbedding, documentIds, limit, threshold);
        }

        const candidateIds = coarseResults.map(r => r.id);
        const fullStr = `[${queryEmbedding.join(",")}]`;

        const refinedResults = await getDb()
            .select({
                id: documentRetrievalChunks.id,
                content: documentRetrievalChunks.content,
                documentId: documentRetrievalChunks.documentId,
                distance: sql<number>`${documentRetrievalChunks.embedding} <=> ${fullStr}::vector`,
            })
            .from(documentRetrievalChunks)
            .innerJoin(document, eq(documentRetrievalChunks.documentId, document.id))
            .where(
                and(
                    inArray(documentRetrievalChunks.id, candidateIds),
                    eq(documentRetrievalChunks.versionId, document.currentVersionId)
                )
            )
            .orderBy(sql`${documentRetrievalChunks.embedding} <=> ${fullStr}::vector`)
            .limit(limit);

        const contextChunkIds = coarseResults
            .map(r => Number(r.contextChunkId))
            .filter(id => !isNaN(id));

        const pageMap = new Map<number, number>();
        if (contextChunkIds.length > 0) {
            const pages = await getDb()
                .select({
                    id: documentSections.id,
                    page: documentSections.pageNumber,
                })
                .from(documentSections)
                .innerJoin(document, eq(documentSections.documentId, document.id))
                .where(
                    and(
                        inArray(documentSections.id, contextChunkIds),
                        eq(documentSections.versionId, document.currentVersionId)
                    )
                );

            for (const p of pages) {
                pageMap.set(p.id, p.page ?? 1);
            }
        }

        const contextIdMap = new Map(coarseResults.map(r => [r.id, Number(r.contextChunkId)]));

        return refinedResults
            .map(row => {
                const dist = Number(row.distance ?? 1);
                const ctxId = contextIdMap.get(row.id);
                return {
                    id: row.id,
                    content: row.content,
                    page: ctxId ? (pageMap.get(ctxId) ?? 1) : 1,
                    documentId: Number(row.documentId),
                    distance: dist,
                    confidence: Math.max(0, 1 - dist),
                };
            })
            .filter(r => r.distance <= threshold);
    } catch (error) {
        console.warn("Matryoshka search failed:", sanitizeErrorMessage(error));
        return [];
    }
}
