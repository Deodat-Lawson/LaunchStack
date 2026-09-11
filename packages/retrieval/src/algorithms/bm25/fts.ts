/**
 * Postgres full-text variant of the lexical leg: `to_tsquery` OR-matching
 * ranked by `ts_rank`, entirely SQL-side. Cheaper than fetching chunks for
 * in-memory BM25 when the caller only needs a ranked list (page-level fusion
 * in the hybrid search) rather than LangChain Documents.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import type { RankedResult } from "../fusion/rrf";

export async function ftsSearch(
    query: string,
    docIds: number[],
    limit = 10
): Promise<RankedResult[]> {
    if (docIds.length === 0) return [];

    const tsQuery = query
        .split(/\s+/)
        .filter(w => w.length > 1)
        .map(w => w.replace(/[^a-zA-Z0-9]/g, ""))
        .filter(Boolean)
        .join(" | ");

    if (!tsQuery) return [];

    const results = await getDb()
        .select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            rank: sql<number>`ts_rank(to_tsvector('english', ${documentSections.content}), to_tsquery('english', ${tsQuery}))`,
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
                sql`to_tsvector('english', ${documentSections.content}) @@ to_tsquery('english', ${tsQuery})`
            )
        )
        .orderBy(
            sql`ts_rank(to_tsvector('english', ${documentSections.content}), to_tsquery('english', ${tsQuery})) DESC`
        )
        .limit(limit);

    return results.map((r, idx) => ({
        documentId: Number(r.documentId),
        page: r.page ?? 1,
        content: r.content,
        rank: idx + 1,
    }));
}
