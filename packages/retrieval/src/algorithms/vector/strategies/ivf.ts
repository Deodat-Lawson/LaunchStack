/**
 * IVF-style cluster probing: rank per-document centroid clusters against the
 * query, scan only the chunks belonging to the top `probeCount` clusters.
 * Trades recall for latency on multi-document scopes; falls back to the
 * exact scan when no cluster matches.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import type { ANNResult } from "../../../search-types";
import { findRelevantDocumentClusters } from "./clusters";
import { exactScanSearch } from "./exact";
import { sanitizeErrorMessage } from "./sanitize";

export async function ivfSearch(
    queryEmbedding: number[],
    documentIds: number[],
    limit: number,
    threshold: number,
    probeCount = 3
): Promise<ANNResult[]> {
    try {
        const relevantClusters = await findRelevantDocumentClusters(
            queryEmbedding,
            documentIds,
            probeCount
        );

        if (relevantClusters.length === 0) {
            return exactScanSearch(queryEmbedding, documentIds, limit, threshold);
        }

        const clusterChunkIds = relevantClusters.flatMap(c => c.chunkIds);

        if (clusterChunkIds.length === 0) {
            return [];
        }

        const embeddingStr = `[${queryEmbedding.join(",")}]`;

        const results = await getDb()
            .select({
                id: documentSections.id,
                content: documentSections.content,
                page: documentSections.pageNumber,
                documentId: documentSections.documentId,
                distance: sql<number>`${documentSections.embedding} <=> ${embeddingStr}::vector`,
            })
            .from(documentSections)
            .innerJoin(document, eq(documentSections.documentId, document.id))
            .where(
                and(
                    inArray(documentSections.id, clusterChunkIds),
                    eq(documentSections.versionId, document.currentVersionId),
                    sql`${documentSections.embedding} <=> ${embeddingStr}::vector <= ${threshold}`
                )
            )
            .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
            .limit(limit);

        return results.map(row => ({
            id: row.id,
            content: row.content,
            page: row.page ?? 0,
            documentId: Number(row.documentId),
            distance: Number(row.distance ?? 1),
            confidence: Math.max(0, 1 - Number(row.distance ?? 1)),
        }));
    } catch (error) {
        console.warn("IVF search failed:", sanitizeErrorMessage(error));
        return [];
    }
}
