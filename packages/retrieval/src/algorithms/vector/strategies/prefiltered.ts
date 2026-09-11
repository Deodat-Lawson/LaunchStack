/**
 * Prefiltered search: score whole documents against the query first (via
 * their centroid clusters), then scan only documents above the prefilter
 * threshold, most relevant first, until `limit` is filled. Cheaper than a
 * flat scan when most documents in scope are irrelevant; falls back to the
 * exact scan when nothing clears the threshold.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import type { ANNResult } from "../../../search-types";
import { calculateDocumentRelevanceScores } from "./clusters";
import { exactScanSearch } from "./exact";
import { sanitizeErrorMessage } from "./sanitize";

export async function prefilteredSearch(
    queryEmbedding: number[],
    documentIds: number[],
    limit: number,
    threshold: number,
    prefilterThreshold = 0.3
): Promise<ANNResult[]> {
    try {
        const docScores = await calculateDocumentRelevanceScores(queryEmbedding, documentIds);

        const sortedDocIds = docScores
            .filter(d => d.score > prefilterThreshold)
            .sort((a, b) => b.score - a.score)
            .map(d => d.documentId);

        if (sortedDocIds.length === 0) {
            return exactScanSearch(queryEmbedding, documentIds, limit, threshold);
        }

        const results: ANNResult[] = [];
        const embeddingStr = `[${queryEmbedding.join(",")}]`;

        for (const docId of sortedDocIds) {
            if (results.length >= limit) break;

            const remaining = limit - results.length;
            const docResults = await getDb()
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
                        eq(documentSections.documentId, BigInt(docId)),
                        eq(documentSections.versionId, document.currentVersionId),
                        sql`${documentSections.embedding} <=> ${embeddingStr}::vector <= ${threshold}`
                    )
                )
                .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
                .limit(remaining * 2);

            const mappedResults: ANNResult[] = docResults.map(row => ({
                id: row.id,
                content: row.content,
                page: row.page ?? 0,
                documentId: Number(row.documentId),
                distance: Number(row.distance ?? 1),
                confidence: Math.max(0, 1 - Number(row.distance ?? 1)),
            }));

            results.push(...mappedResults.slice(0, remaining));
        }

        return results.sort((a, b) => a.distance - b.distance);
    } catch (error) {
        console.warn("Prefiltered search failed:", sanitizeErrorMessage(error));
        return [];
    }
}
