/**
 * Exact ordered scan over `documentSections.embedding` — the baseline every
 * other strategy falls back to. Fetches an over-sampled candidate window
 * (5×limit, capped at 100) ordered by cosine distance, then refines in
 * memory. When the column carries an HNSW index this is also the "hnsw"
 * strategy: the planner uses the index for the ORDER BY, and the code path
 * is identical.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import type { ANNResult } from "../../../search-types";
import { sanitizeErrorMessage } from "./sanitize";

type ANNRow = { id: number; content: string; page: number; documentId: number; distance: number };

export async function exactScanSearch(
    queryEmbedding: number[],
    documentIds: number[],
    limit: number,
    threshold: number
): Promise<ANNResult[]> {
    try {
        const embeddingStr = `[${queryEmbedding.join(",")}]`;

        const approximateLimit = Math.min(limit * 5, 100);

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
                    inArray(
                        documentSections.documentId,
                        documentIds.map(id => BigInt(id))
                    ),
                    eq(documentSections.versionId, document.currentVersionId)
                )
            )
            .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
            .limit(approximateLimit);

        const rows: ANNRow[] = results.map(r => ({
            id: r.id,
            content: r.content,
            page: r.page ?? 0,
            documentId: Number(r.documentId),
            distance: Number(r.distance ?? 1),
        }));

        const refinedResults = rows
            .map(row => ({
                ...row,
                confidence: Math.max(0, 1 - row.distance),
            }))
            .filter(r => r.distance <= threshold)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);

        return refinedResults;
    } catch (error) {
        console.warn("Exact-scan (hnsw) search failed:", sanitizeErrorMessage(error));
        return [];
    }
}
