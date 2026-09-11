/**
 * Lexical + dense hybrid search fused with RRF, at page granularity: the FTS
 * leg and a raw cosine-distance scan each produce a ranked list, RRF merges
 * them, and the top fused pages come back with a snippet and a bounded
 * pseudo-similarity. The query embedder is injected — this module never
 * chooses an embedding provider.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import { ftsSearch } from "../bm25/fts";
import { reciprocalRankFusion, type RankedResult } from "./rrf";

export interface HybridSearchMatch {
    documentId: number;
    page: number;
    snippet: string;
    similarity: number;
    content: string;
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
}

/**
 * Dense vector leg: cosine distance over `documentSections.embedding`,
 * returned as a ranked list for fusion.
 */
async function vectorRankedSearch(
    queryEmbedding: number[],
    docIds: number[],
    limit = 10,
    threshold = 0.4
): Promise<RankedResult[]> {
    if (docIds.length === 0 || queryEmbedding.length === 0) return [];

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
                inArray(
                    documentSections.documentId,
                    docIds.map(id => BigInt(id))
                ),
                eq(documentSections.versionId, document.currentVersionId),
                sql`${documentSections.embedding} <=> ${embeddingStr}::vector < ${threshold}`
            )
        )
        .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
        .limit(limit);

    return results.map((r, idx) => ({
        documentId: Number(r.documentId),
        page: r.page ?? 1,
        content: r.content,
        rank: idx + 1,
    }));
}

/**
 * Hybrid search combining full-text and vector similarity with RRF.
 * `embedQuery` supplies the query vector (empty vector ⇒ lexical-only).
 */
export async function hybridSearchWithRRF(
    query: string,
    docIds: number[],
    limit: number,
    embedQuery: (query: string) => Promise<number[]>
): Promise<HybridSearchMatch[]> {
    if (docIds.length === 0) return [];

    const [ftsResults, vecResults] = await Promise.all([
        ftsSearch(query, docIds, limit * 2).catch(() => [] as RankedResult[]),
        embedQuery(query)
            .then(embedding => vectorRankedSearch(embedding, docIds, limit * 2))
            .catch(() => [] as RankedResult[]),
    ]);

    if (ftsResults.length === 0 && vecResults.length === 0) return [];

    const fused = reciprocalRankFusion([ftsResults, vecResults]);

    return Array.from(fused.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(r => ({
            documentId: r.documentId,
            page: r.page,
            snippet: truncate(r.content, 150),
            similarity: Math.min(r.score * 60, 0.95),
            content: r.content,
        }));
}
