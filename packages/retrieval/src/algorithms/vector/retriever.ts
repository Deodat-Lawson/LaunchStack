import { sql } from "drizzle-orm";
import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";

import { getDb, toRows } from "@launchstack/store/client";
import { NAME, T } from "@launchstack/store/tables";
import {
    isLegacyEmbeddingIndex,
    supportsShortVectorSearch,
    type EmbeddingIndexConfig,
} from "@launchstack/llm/embeddings";
import type {
    DocumentScope,
    EmbeddingsProvider,
    SearchScope,
    SearchFilters,
} from "../../search-types";
import { documentScopeSqlForAlias } from "../scope";

interface VectorRetrieverConfig extends BaseRetrieverInput {
    embeddings: EmbeddingsProvider;
    embeddingIndex: EmbeddingIndexConfig;
    topK?: number;
    searchScope: SearchScope;
    filters?: SearchFilters;
}

interface SingleDocConfig extends VectorRetrieverConfig {
    documentId: number;
    searchScope: "document";
}

interface CompanyConfig extends VectorRetrieverConfig {
    companyId: number;
    searchScope: "company";
    /** The caller's document scope; joins the `d` predicate of every company query. */
    scope?: DocumentScope;
}

interface MultiDocConfig extends VectorRetrieverConfig {
    documentIds: number[];
    searchScope: "multi-document";
}

type VectorRetrieverFields = SingleDocConfig | CompanyConfig | MultiDocConfig;

type VectorRow = {
    child_id: number;
    parent_content: string;
    child_content: string;
    page: number;
    document_id: number;
    /** documents.current_version_id — carried for citation anchoring. */
    version_id: number;
    document_title: string;
    /** documents.category — the folder, for scope re-checks downstream. */
    category: string;
    distance: number;
};

function buildScopeWhere(
    scope: SearchScope,
    ids: {
        documentId?: number;
        companyId?: number;
        documentIds?: number[];
        documentScope?: DocumentScope;
    },
    retrievalAlias: string
): ReturnType<typeof sql> | null {
    if (scope === "document" && ids.documentId !== undefined) {
        return sql.raw(`${retrievalAlias}.document_id = ${ids.documentId}`);
    }
    if (scope === "company" && ids.companyId !== undefined) {
        // Every company query joins the document table as `d`, so the caller's
        // scope narrows candidates before the ANN scan, not after.
        const company = sql.raw(`d.company_id = ${ids.companyId}`);
        const scoped = documentScopeSqlForAlias(ids.documentScope, "d");
        return scoped ? sql`${company} AND (${scoped})` : company;
    }
    if (scope === "multi-document" && ids.documentIds?.length) {
        return sql.raw(
            `${retrievalAlias}.document_id = ANY('{${ids.documentIds.join(",")}}'::int[])`
        );
    }
    return null;
}

function buildFilterWhere(filters?: SearchFilters): ReturnType<typeof sql> {
    let filterWhere = sql``;
    if (!filters) return filterWhere;

    if (filters.documentClass) {
        filterWhere = sql`${filterWhere} AND dm.document_class = ${filters.documentClass}`;
    }
    if (filters.dateRange?.start) {
        filterWhere = sql`${filterWhere} AND dm.date_range_start >= ${filters.dateRange.start.toISOString()}`;
    }
    if (filters.dateRange?.end) {
        filterWhere = sql`${filterWhere} AND dm.date_range_end <= ${filters.dateRange.end.toISOString()}`;
    }
    if (filters.topicTags && filters.topicTags.length > 0) {
        const tagsJson = JSON.stringify(filters.topicTags);
        filterWhere = sql`${filterWhere} AND dm.topic_tags @> ${tagsJson}::jsonb`;
    }
    return filterWhere;
}

function getDimensionTableName(index: EmbeddingIndexConfig): string {
    if (index.dimension === 768) return NAME.embeddings768;
    if (index.dimension === 1024) return NAME.embeddings1024;
    throw new Error(
        `No dimension table is configured for index "${index.indexKey}" (${index.dimension} dims)`
    );
}

// Only return chunks whose version matches the document's current version.
// Historical chunks remain indexed for efficient reverts but are hidden from
// retrieval.
const rcVersionFilter = sql` AND rc.version_id = d.current_version_id`;
const sVersionFilter = sql` AND s.version_id = d.current_version_id`;

async function searchLegacyIndex(args: {
    embeddingIndex: EmbeddingIndexConfig;
    fullEmbedding: number[];
    topK: number;
    scopeWhere: ReturnType<typeof sql>;
    fallbackScopeWhere: ReturnType<typeof sql>;
    filterWhere: ReturnType<typeof sql>;
}): Promise<VectorRow[]> {
    const { embeddingIndex, fullEmbedding, topK, scopeWhere, fallbackScopeWhere, filterWhere } =
        args;
    const fullBracketed = `[${fullEmbedding.join(",")}]`;
    const fullVectorLiteral = sql.raw(`'${fullBracketed}'::vector(${embeddingIndex.dimension})`);

    if (supportsShortVectorSearch(embeddingIndex) && embeddingIndex.shortDimension) {
        const shortEmbedding = fullEmbedding.slice(0, embeddingIndex.shortDimension);
        const shortBracketed = `[${shortEmbedding.join(",")}]`;
        const shortVectorLiteral = sql.raw(
            `'${shortBracketed}'::vector(${embeddingIndex.shortDimension})`
        );

        const sqlQuery = sql`
      WITH candidates AS (
        SELECT
          rc.id,
          rc.context_chunk_id,
          rc.document_id,
          rc.content as child_content,
          rc.embedding,
          (rc.embedding_short <-> ${shortVectorLiteral}) as rough_distance
        FROM ${T.retrievalChunks} rc
        JOIN ${T.document} d ON rc.document_id = d.id
        LEFT JOIN ${T.metadata} dm
          ON d.id = dm.document_id
         AND dm.version_id = d.current_version_id
        WHERE ${scopeWhere}${rcVersionFilter} ${filterWhere}
        AND rc.embedding IS NOT NULL
        AND rc.embedding_short IS NOT NULL
        ORDER BY rc.embedding_short <-> ${shortVectorLiteral}
        LIMIT ${topK * 5}
      )
      SELECT
        c.id as child_id,
        cc.content as parent_content,
        c.child_content,
        cc.page_number as page,
        cc.document_id,
        d.current_version_id as version_id,
        d.title as document_title, d.category as category,
        (c.embedding <-> ${fullVectorLiteral}) as distance
      FROM candidates c
      JOIN ${T.document} d ON c.document_id = d.id
      JOIN ${T.contextChunks} cc
        ON c.context_chunk_id = cc.id
       AND cc.document_id = d.id
       AND cc.version_id = d.current_version_id
      ORDER BY distance ASC
      LIMIT ${topK}
    `;

        const shortRows = toRows<VectorRow>(await getDb().execute<VectorRow>(sqlQuery));
        if (shortRows.length > 0) {
            return shortRows;
        }
    }

    const fullQuery = sql`
    SELECT
      rc.id as child_id,
      cc.content as parent_content,
      rc.content as child_content,
      cc.page_number as page,
      cc.document_id,
      d.current_version_id as version_id,
      d.title as document_title, d.category as category,
      (rc.embedding <-> ${fullVectorLiteral}) as distance
    FROM ${T.retrievalChunks} rc
    JOIN ${T.document} d ON rc.document_id = d.id
    JOIN ${T.contextChunks} cc
      ON rc.context_chunk_id = cc.id
     AND cc.document_id = d.id
     AND cc.version_id = d.current_version_id
    LEFT JOIN ${T.metadata} dm
      ON d.id = dm.document_id
     AND dm.version_id = d.current_version_id
    WHERE ${scopeWhere}${rcVersionFilter} ${filterWhere}
    AND rc.embedding IS NOT NULL
    ORDER BY rc.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

    const rows = toRows<VectorRow>(await getDb().execute<VectorRow>(fullQuery));
    if (rows.length > 0) {
        return rows;
    }

    const fallbackQuery = sql`
    SELECT
      s.id as child_id,
      s.content as parent_content,
      s.content as child_content,
      s.page_number as page,
      s.document_id,
      d.current_version_id as version_id,
      d.title as document_title, d.category as category,
      s.embedding <-> ${fullVectorLiteral} AS distance
    FROM ${T.contextChunks} s
    JOIN ${T.document} d ON s.document_id = d.id
    LEFT JOIN ${T.metadata} dm
      ON d.id = dm.document_id
     AND dm.version_id = d.current_version_id
    WHERE ${fallbackScopeWhere}${sVersionFilter} ${filterWhere}
    AND s.embedding IS NOT NULL
    ORDER BY s.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

    return toRows<VectorRow>(await getDb().execute<VectorRow>(fallbackQuery));
}

async function searchDimensionTableIndex(args: {
    embeddingIndex: EmbeddingIndexConfig;
    fullEmbedding: number[];
    topK: number;
    scopeWhere: ReturnType<typeof sql>;
    filterWhere: ReturnType<typeof sql>;
}): Promise<VectorRow[]> {
    const { embeddingIndex, fullEmbedding, topK, scopeWhere, filterWhere } = args;
    const tableName = getDimensionTableName(embeddingIndex);
    const fullBracketed = `[${fullEmbedding.join(",")}]`;
    const fullVectorLiteral = sql.raw(`'${fullBracketed}'::vector(${embeddingIndex.dimension})`);

    const sqlQuery = sql`
    SELECT
      de.retrieval_chunk_id as child_id,
      cc.content as parent_content,
      rc.content as child_content,
      cc.page_number as page,
      rc.document_id,
      d.current_version_id as version_id,
      d.title as document_title, d.category as category,
      (de.embedding <-> ${fullVectorLiteral}) as distance
    FROM ${sql.raw(tableName)} de
    JOIN ${T.retrievalChunks} rc ON de.retrieval_chunk_id = rc.id
    JOIN ${T.document} d ON rc.document_id = d.id
    JOIN ${T.contextChunks} cc
      ON rc.context_chunk_id = cc.id
     AND cc.document_id = d.id
     AND cc.version_id = d.current_version_id
    LEFT JOIN ${T.metadata} dm
      ON d.id = dm.document_id
     AND dm.version_id = d.current_version_id
    WHERE ${scopeWhere}${rcVersionFilter} ${filterWhere}
    AND de.index_key = ${embeddingIndex.indexKey}
    ORDER BY de.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

    return toRows<VectorRow>(await getDb().execute<VectorRow>(sqlQuery));
}

export class VectorRetriever extends BaseRetriever {
    lc_namespace = ["rag", "retrievers", "vector"];

    private embeddings: EmbeddingsProvider;
    private embeddingIndex: EmbeddingIndexConfig;
    private topK: number;
    private searchScope: SearchScope;
    private documentId?: number;
    private companyId?: number;
    private documentIds?: number[];
    private filters?: SearchFilters;
    private scope?: DocumentScope;

    constructor(fields: VectorRetrieverFields) {
        super(fields);
        this.embeddings = fields.embeddings;
        this.embeddingIndex = fields.embeddingIndex;
        this.topK = fields.topK ?? 8;
        this.searchScope = fields.searchScope;
        this.filters = fields.filters;

        if (fields.searchScope === "document") {
            this.documentId = fields.documentId;
        } else if (fields.searchScope === "company") {
            this.companyId = fields.companyId;
            this.scope = fields.scope;
        } else if (fields.searchScope === "multi-document") {
            this.documentIds = fields.documentIds;
        }
    }

    async _getRelevantDocuments(
        query: string,
        _runManager?: CallbackManagerForRetrieverRun
    ): Promise<Document[]> {
        try {
            const fullEmbedding = await this.embeddings.embedQuery(query);
            const scopeWhere = buildScopeWhere(
                this.searchScope,
                {
                    documentId: this.documentId,
                    companyId: this.companyId,
                    documentIds: this.documentIds,
                    documentScope: this.scope,
                },
                "rc"
            );
            const fallbackScopeWhere = buildScopeWhere(
                this.searchScope,
                {
                    documentId: this.documentId,
                    companyId: this.companyId,
                    documentIds: this.documentIds,
                    documentScope: this.scope,
                },
                "s"
            );

            if (!scopeWhere || !fallbackScopeWhere) return [];

            const filterWhere = buildFilterWhere(this.filters);
            const rows = isLegacyEmbeddingIndex(this.embeddingIndex)
                ? await searchLegacyIndex({
                      embeddingIndex: this.embeddingIndex,
                      fullEmbedding,
                      topK: this.topK,
                      scopeWhere,
                      fallbackScopeWhere,
                      filterWhere,
                  })
                : await searchDimensionTableIndex({
                      embeddingIndex: this.embeddingIndex,
                      fullEmbedding,
                      topK: this.topK,
                      scopeWhere,
                      filterWhere,
                  });

            const documents = rows.map(
                row =>
                    new Document({
                        pageContent: row.parent_content,
                        metadata: {
                            chunkId: row.child_id,
                            childContent: row.child_content,
                            page: row.page,
                            documentId: row.document_id,
                            // bigint columns can surface as strings; normalize
                            // so citation anchoring sees a number.
                            versionId: row.version_id != null ? Number(row.version_id) : undefined,
                            documentTitle: row.document_title,
                            category: row.category,
                            distance: row.distance,
                            source: "vector_ann",
                            searchScope: this.searchScope,
                            retrievalType: "parent_child",
                            embeddingIndexKey: this.embeddingIndex.indexKey,
                        },
                    })
            );

            console.log(
                `[VectorRetriever] Retrieved ${documents.length} chunks (scope=${this.searchScope}, index=${this.embeddingIndex.indexKey})`
            );

            return documents;
        } catch (error) {
            console.error("[VectorRetriever] Error:", error);
            return [];
        }
    }
}

export function createDocumentVectorRetriever(
    documentId: number,
    embeddings: EmbeddingsProvider,
    embeddingIndex: EmbeddingIndexConfig,
    topK = 8,
    filters?: SearchFilters
): VectorRetriever {
    return new VectorRetriever({
        documentId,
        embeddings,
        embeddingIndex,
        topK,
        searchScope: "document",
        filters,
    });
}

export function createCompanyVectorRetriever(
    companyId: number,
    embeddings: EmbeddingsProvider,
    embeddingIndex: EmbeddingIndexConfig,
    topK = 10,
    filters?: SearchFilters,
    scope?: DocumentScope
): VectorRetriever {
    return new VectorRetriever({
        companyId,
        embeddings,
        embeddingIndex,
        topK,
        searchScope: "company",
        filters,
        scope,
    });
}

export function createMultiDocVectorRetriever(
    documentIds: number[],
    embeddings: EmbeddingsProvider,
    embeddingIndex: EmbeddingIndexConfig,
    topK = 8,
    filters?: SearchFilters
): VectorRetriever {
    return new VectorRetriever({
        documentIds,
        embeddings,
        embeddingIndex,
        topK,
        searchScope: "multi-document",
        filters,
    });
}
