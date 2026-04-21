import { db } from "~/server/db/index";
import { and, inArray, sql } from "drizzle-orm";
import { documentSections } from "@launchstack/core/db/schema";
import { getEmbeddings } from "~/app/api/agents/predictive-document-analysis/utils/embeddings";
import { truncateText } from "~/app/api/agents/predictive-document-analysis/utils/content";
import type { DocumentMatch } from "~/app/api/agents/predictive-document-analysis/types";

interface RankedResult {
    documentId: number;
    page: number;
    content: string;
    rank: number;
}

/**
 * Full-text search using PostgreSQL's built-in ts_vector/ts_query.
 * Returns results ranked by ts_rank.
 */
async function bm25Search(
    query: string,
    docIds: number[],
    limit = 10,
): Promise<RankedResult[]> {
    if (docIds.length === 0) return [];

    const tsQuery = query
        .split(/\s+/)
        .filter(w => w.length > 1)
        .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter(Boolean)
        .join(' | ');

    if (!tsQuery) return [];

    const results = await db.select({
        id: documentSections.id,
        content: documentSections.content,
        page: documentSections.pageNumber,
        documentId: documentSections.documentId,
        rank: sql<number>`ts_rank(to_tsvector('english', ${documentSections.content}), to_tsquery('english', ${tsQuery}))`,
    })
    .from(documentSections)
    .where(and(
        inArray(documentSections.documentId, docIds.map(id => BigInt(id))),
        sql`to_tsvector('english', ${documentSections.content}) @@ to_tsquery('english', ${tsQuery})`,
    ))
    .orderBy(sql`ts_rank(to_tsvector('english', ${documentSections.content}), to_tsquery('english', ${tsQuery})) DESC`)
    .limit(limit);

    return results.map((r, idx) => ({
        documentId: Number(r.documentId),
        page: r.page ?? 1,
        content: r.content,
        rank: idx + 1,
    }));
}

/**
 * Dense vector search using cosine similarity.
 */
async function vectorSearch(
    query: string,
    docIds: number[],
    limit = 10,
    threshold = 0.4,
): Promise<RankedResult[]> {
    if (docIds.length === 0) return [];

    const queryEmbedding = await getEmbeddings(query);
    if (queryEmbedding.length === 0) return [];

    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await db.select({
        id: documentSections.id,
        content: documentSections.content,
        page: documentSections.pageNumber,
        documentId: documentSections.documentId,
        distance: sql<number>`${documentSections.embedding} <=> ${embeddingStr}::vector`,
    })
    .from(documentSections)
    .where(and(
        inArray(documentSections.documentId, docIds.map(id => BigInt(id))),
        sql`${documentSections.embedding} <=> ${embeddingStr}::vector < ${threshold}`,
    ))
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
 * Reciprocal Rank Fusion: merges ranked lists from different retrieval methods.
 * RRF(d) = sum( 1 / (k + rank_i(d)) ) for each list i that contains d.
 * k=60 is standard (from the original Cormack et al. paper).
 */
function reciprocalRankFusion(
    lists: RankedResult[][],
    k = 60,
): Map<string, { score: number; documentId: number; page: number; content: string }> {
    const fused = new Map<string, { score: number; documentId: number; page: number; content: string }>();

    for (const list of lists) {
        for (const item of list) {
            const key = `${item.documentId}:${item.page}`;
            const existing = fused.get(key);
            const rrfScore = 1 / (k + item.rank);

            if (existing) {
                existing.score += rrfScore;
                if (item.content.length > existing.content.length) {
                    existing.content = item.content;
                }
            } else {
                fused.set(key, {
                    score: rrfScore,
                    documentId: item.documentId,
                    page: item.page,
                    content: item.content,
                });
            }
        }
    }

    return fused;
}

/**
 * Hybrid search combining BM25 full-text and vector similarity with RRF.
 */
export async function hybridSearchWithRRF(
    query: string,
    docIds: number[],
    limit = 8,
): Promise<DocumentMatch[]> {
    if (docIds.length === 0) return [];

    const [bm25Results, vecResults] = await Promise.all([
        bm25Search(query, docIds, limit * 2).catch(() => [] as RankedResult[]),
        vectorSearch(query, docIds, limit * 2).catch(() => [] as RankedResult[]),
    ]);

    if (bm25Results.length === 0 && vecResults.length === 0) return [];

    const fused = reciprocalRankFusion([bm25Results, vecResults]);

    return Array.from(fused.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(r => ({
            documentId: r.documentId,
            page: r.page,
            snippet: truncateText(r.content, 150),
            similarity: Math.min(r.score * 60, 0.95),
            content: r.content,
        }));
}
