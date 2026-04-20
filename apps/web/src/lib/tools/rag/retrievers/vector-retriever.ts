import { db, toRows } from "~/server/db/index";
import { sql } from "drizzle-orm";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";

import {
  isLegacyEmbeddingIndex,
  supportsShortVectorSearch,
  type EmbeddingIndexConfig,
} from "@launchstack/core/embeddings";
import type { EmbeddingsProvider, SearchScope, SearchFilters } from "../types";

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
  document_title: string;
  distance: number;
};

function buildScopeWhere(
  scope: SearchScope,
  ids: { documentId?: number; companyId?: number; documentIds?: number[] },
  retrievalAlias: string,
): ReturnType<typeof sql> | null {
  if (scope === "document" && ids.documentId !== undefined) {
    return sql.raw(`${retrievalAlias}.document_id = ${ids.documentId}`);
  }
  if (scope === "company" && ids.companyId !== undefined) {
    return sql.raw(`d.company_id = ${ids.companyId}`);
  }
  if (scope === "multi-document" && ids.documentIds?.length) {
    return sql.raw(
      `${retrievalAlias}.document_id = ANY('{${ids.documentIds.join(",")}}'::int[])`,
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
  if (index.dimension === 768) return "pdr_ai_v2_document_embeddings_768";
  if (index.dimension === 1024) return "pdr_ai_v2_document_embeddings_1024";
  throw new Error(
    `No dimension table is configured for index "${index.indexKey}" (${index.dimension} dims)`,
  );
}

// Version filter: only return chunks from the current version of each
// document. Chunks from older versions stay indexed (so revert is O(1)) but
// must be hidden from RAG results. The `IS NULL` branches keep this safe
// during rollout — documents/chunks not yet backfilled return unfiltered,
// and once backfill is complete this degenerates to strict equality.
const rcVersionFilter = sql` AND (d.current_version_id IS NULL OR rc.version_id IS NULL OR rc.version_id = d.current_version_id)`;
const sVersionFilter = sql` AND (d.current_version_id IS NULL OR s.version_id IS NULL OR s.version_id = d.current_version_id)`;

async function searchLegacyIndex(args: {
  embeddingIndex: EmbeddingIndexConfig;
  fullEmbedding: number[];
  topK: number;
  scopeWhere: ReturnType<typeof sql>;
  fallbackScopeWhere: ReturnType<typeof sql>;
  filterWhere: ReturnType<typeof sql>;
}): Promise<VectorRow[]> {
  const { embeddingIndex, fullEmbedding, topK, scopeWhere, fallbackScopeWhere, filterWhere } = args;
  const fullBracketed = `[${fullEmbedding.join(",")}]`;
  const fullVectorLiteral = sql.raw(`'${fullBracketed}'::vector(${embeddingIndex.dimension})`);

  if (supportsShortVectorSearch(embeddingIndex) && embeddingIndex.shortDimension) {
    const shortEmbedding = fullEmbedding.slice(0, embeddingIndex.shortDimension);
    const shortBracketed = `[${shortEmbedding.join(",")}]`;
    const shortVectorLiteral = sql.raw(`'${shortBracketed}'::vector(${embeddingIndex.shortDimension})`);

    const sqlQuery = sql`
      WITH candidates AS (
        SELECT
          rc.id,
          rc.context_chunk_id,
          rc.content as child_content,
          rc.embedding,
          (rc.embedding_short <-> ${shortVectorLiteral}) as rough_distance
        FROM pdr_ai_v2_document_retrieval_chunks rc
        JOIN pdr_ai_v2_document d ON rc.document_id = d.id
        LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
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
        d.title as document_title,
        (c.embedding <-> ${fullVectorLiteral}) as distance
      FROM candidates c
      JOIN pdr_ai_v2_document_context_chunks cc ON c.context_chunk_id = cc.id
      JOIN pdr_ai_v2_document d ON cc.document_id = d.id
      ORDER BY distance ASC
      LIMIT ${topK}
    `;

    const shortRows = toRows<VectorRow>(await db.execute<VectorRow>(sqlQuery));
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
      d.title as document_title,
      (rc.embedding <-> ${fullVectorLiteral}) as distance
    FROM pdr_ai_v2_document_retrieval_chunks rc
    JOIN pdr_ai_v2_document_context_chunks cc ON rc.context_chunk_id = cc.id
    JOIN pdr_ai_v2_document d ON rc.document_id = d.id
    LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
    WHERE ${scopeWhere}${rcVersionFilter} ${filterWhere}
    AND rc.embedding IS NOT NULL
    ORDER BY rc.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

  const rows = toRows<VectorRow>(await db.execute<VectorRow>(fullQuery));
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
      d.title as document_title,
      s.embedding <-> ${fullVectorLiteral} AS distance
    FROM pdr_ai_v2_document_context_chunks s
    JOIN pdr_ai_v2_document d ON s.document_id = d.id
    LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
    WHERE ${fallbackScopeWhere}${sVersionFilter} ${filterWhere}
    AND s.embedding IS NOT NULL
    ORDER BY s.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

  return toRows<VectorRow>(await db.execute<VectorRow>(fallbackQuery));
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
      d.title as document_title,
      (de.embedding <-> ${fullVectorLiteral}) as distance
    FROM ${sql.raw(tableName)} de
    JOIN pdr_ai_v2_document_retrieval_chunks rc ON de.retrieval_chunk_id = rc.id
    JOIN pdr_ai_v2_document_context_chunks cc ON rc.context_chunk_id = cc.id
    JOIN pdr_ai_v2_document d ON rc.document_id = d.id
    LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
    WHERE ${scopeWhere}${rcVersionFilter} ${filterWhere}
    AND de.index_key = ${embeddingIndex.indexKey}
    ORDER BY de.embedding <-> ${fullVectorLiteral}
    LIMIT ${topK}
  `;

  return toRows<VectorRow>(await db.execute<VectorRow>(sqlQuery));
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
    } else if (fields.searchScope === "multi-document") {
      this.documentIds = fields.documentIds;
    }
  }

  async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun,
  ): Promise<Document[]> {
    try {
      const fullEmbedding = await this.embeddings.embedQuery(query);
      const scopeWhere = buildScopeWhere(
        this.searchScope,
        {
          documentId: this.documentId,
          companyId: this.companyId,
          documentIds: this.documentIds,
        },
        "rc",
      );
      const fallbackScopeWhere = buildScopeWhere(
        this.searchScope,
        {
          documentId: this.documentId,
          companyId: this.companyId,
          documentIds: this.documentIds,
        },
        "s",
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

      const documents = rows.map((row) => new Document({
        pageContent: row.parent_content,
        metadata: {
          chunkId: row.child_id,
          childContent: row.child_content,
          page: row.page,
          documentId: row.document_id,
          documentTitle: row.document_title,
          distance: row.distance,
          source: "vector_ann",
          searchScope: this.searchScope,
          retrievalType: "parent_child",
          embeddingIndexKey: this.embeddingIndex.indexKey,
        },
      }));

      console.log(
        `[VectorRetriever] Retrieved ${documents.length} chunks (scope=${this.searchScope}, index=${this.embeddingIndex.indexKey})`,
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
  filters?: SearchFilters,
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
): VectorRetriever {
  return new VectorRetriever({
    companyId,
    embeddings,
    embeddingIndex,
    topK,
    searchScope: "company",
    filters,
  });
}

export function createMultiDocVectorRetriever(
  documentIds: number[],
  embeddings: EmbeddingsProvider,
  embeddingIndex: EmbeddingIndexConfig,
  topK = 8,
  filters?: SearchFilters,
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
