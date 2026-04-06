import { db, toRows } from "~/server/db/index";
import { sql } from "drizzle-orm";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import type { EmbeddingsProvider, SearchScope, SearchFilters } from "../types";
import {
  getCompanyEmbeddingTableName,
  companyEmbeddingTableExists,
} from "~/lib/db/company-embeddings";
import { getCompanyEmbeddingConfig } from "~/lib/ai/embedding-factory";

interface VectorRetrieverConfig extends BaseRetrieverInput {
  embeddings: EmbeddingsProvider;
  companyId: number;
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

export class VectorRetriever extends BaseRetriever {
  lc_namespace = ["rag", "retrievers", "vector"];

  private embeddings: EmbeddingsProvider;
  private topK: number;
  private searchScope: SearchScope;
  private companyId: number;
  private documentId?: number;
  private documentIds?: number[];
  private filters?: SearchFilters;

  constructor(fields: VectorRetrieverFields) {
    super(fields);
    this.embeddings = fields.embeddings;
    this.topK = fields.topK ?? 8;
    this.searchScope = fields.searchScope;
    this.companyId = fields.companyId;
    this.filters = fields.filters;

    if (fields.searchScope === "document") {
      this.documentId = fields.documentId;
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
      const fullBracketed = `[${fullEmbedding.join(",")}]`;
      const dimensions = fullEmbedding.length;

      // Try per-company embedding table first
      const hasCompanyTable = await companyEmbeddingTableExists(this.companyId);

      let rows: VectorRow[];
      if (hasCompanyTable) {
        rows = await this.searchCompanyTable(fullBracketed, dimensions);
      } else {
        // Fallback to legacy shared tables for companies not yet migrated
        rows = await this.searchLegacyTables(fullBracketed, fullEmbedding);
      }

      const documents = rows.map((row) => {
        return new Document({
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
          },
        });
      });

      console.log(
        `✅ [VectorRetriever] Retrieved ${documents.length} chunks (scope: ${this.searchScope}, companyTable: ${hasCompanyTable})`
      );

      return documents;
    } catch (error) {
      console.error("[VectorRetriever] Error:", error);
      return [];
    }
  }

  /**
   * Search the per-company embedding table.
   * Joins back to context chunks and documents for metadata.
   */
  private async searchCompanyTable(
    fullBracketed: string,
    dimensions: number,
  ): Promise<VectorRow[]> {
    const tableName = getCompanyEmbeddingTableName(this.companyId);
    const dimStr = String(dimensions);

    let scopeWhere: ReturnType<typeof sql>;
    if (this.searchScope === "document" && this.documentId !== undefined) {
      scopeWhere = sql`e.document_id = ${this.documentId}`;
    } else if (this.searchScope === "company") {
      scopeWhere = sql`1=1`; // All docs in this company's table belong to this company
    } else if (this.searchScope === "multi-document" && this.documentIds?.length) {
      scopeWhere = sql`e.document_id = ANY(${`{${this.documentIds.join(",")}}`}::int[])`;
    } else {
      return [];
    }

    // Metadata filters
    let filterWhere = sql``;
    if (this.filters) {
      if (this.filters.documentClass) {
        filterWhere = sql`${filterWhere} AND dm.document_class = ${this.filters.documentClass}`;
      }
      if (this.filters.dateRange?.start) {
        filterWhere = sql`${filterWhere} AND dm.date_range_start >= ${this.filters.dateRange.start.toISOString()}`;
      }
      if (this.filters.dateRange?.end) {
        filterWhere = sql`${filterWhere} AND dm.date_range_end <= ${this.filters.dateRange.end.toISOString()}`;
      }
      if (this.filters.topicTags && this.filters.topicTags.length > 0) {
        const tagsJson = JSON.stringify(this.filters.topicTags);
        filterWhere = sql`${filterWhere} AND dm.topic_tags @> ${tagsJson}::jsonb`;
      }
    }

    const fullWhere = sql`${scopeWhere} ${filterWhere}`;

    // Search per-company table, join to context chunks for parent content + page
    const query = sql`
      SELECT
          e.id as child_id,
          COALESCE(cc.content, e.content) as parent_content,
          e.content as child_content,
          COALESCE(cc.page_number, 0) as page,
          e.document_id,
          d.title as document_title,
          e.embedding <-> ${fullBracketed}::vector(${sql.raw(dimStr)}) AS distance
      FROM ${sql.raw(tableName)} e
      JOIN pdr_ai_v2_document d ON e.document_id = d.id
      LEFT JOIN pdr_ai_v2_document_context_chunks cc ON e.chunk_type = 'retrieval' AND e.chunk_id = cc.id
      LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
      WHERE ${fullWhere}
      AND e.embedding IS NOT NULL
      ORDER BY e.embedding <-> ${fullBracketed}::vector(${sql.raw(dimStr)})
      LIMIT ${this.topK}
    `;

    const result = await db.execute<VectorRow>(query);
    return toRows<VectorRow>(result);
  }

  /**
   * Fallback: search the legacy shared tables (for companies not yet migrated
   * to per-company embedding tables). Uses the original 2-step retrieval
   * with 1536-dim embeddings.
   */
  private async searchLegacyTables(
    fullBracketed: string,
    fullEmbedding: number[],
  ): Promise<VectorRow[]> {
    const shortEmbedding = fullEmbedding.slice(0, 512);
    const shortBracketed = `[${shortEmbedding.join(",")}]`;

    let baseWhere;
    if (this.searchScope === "document" && this.documentId !== undefined) {
      baseWhere = sql`rc.document_id = ${this.documentId}`;
    } else if (this.searchScope === "company") {
      baseWhere = sql`d.company_id = ${this.companyId}`;
    } else if (this.searchScope === "multi-document" && this.documentIds?.length) {
      baseWhere = sql`rc.document_id = ANY(${`{${this.documentIds.join(",")}}`}::int[])`;
    } else {
      return [];
    }

    let filterWhere = sql``;
    if (this.filters) {
      if (this.filters.documentClass) {
        filterWhere = sql`${filterWhere} AND dm.document_class = ${this.filters.documentClass}`;
      }
      if (this.filters.dateRange?.start) {
        filterWhere = sql`${filterWhere} AND dm.date_range_start >= ${this.filters.dateRange.start.toISOString()}`;
      }
      if (this.filters.dateRange?.end) {
        filterWhere = sql`${filterWhere} AND dm.date_range_end <= ${this.filters.dateRange.end.toISOString()}`;
      }
      if (this.filters.topicTags && this.filters.topicTags.length > 0) {
        const tagsJson = JSON.stringify(this.filters.topicTags);
        filterWhere = sql`${filterWhere} AND dm.topic_tags @> ${tagsJson}::jsonb`;
      }
    }

    const fullWhere = sql`${baseWhere} ${filterWhere}`;

    // 2-Step Retrieval with legacy shared tables
    const sqlQuery = sql`
      WITH candidates AS (
          SELECT
              rc.id,
              rc.context_chunk_id,
              rc.content as child_content,
              rc.token_count as child_tokens,
              rc.embedding,
              (rc.embedding_short <-> ${shortBracketed}::vector(512)) as rough_distance
          FROM pdr_ai_v2_document_retrieval_chunks rc
          JOIN pdr_ai_v2_document d ON rc.document_id = d.id
          LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
          WHERE ${fullWhere}
          ORDER BY rc.embedding_short <-> ${shortBracketed}::vector(512)
          LIMIT ${this.topK * 5}
      )
      SELECT
          c.id as child_id,
          cc.content as parent_content,
          c.child_content,
          cc.page_number as page,
          cc.document_id,
          d.title as document_title,
          (c.embedding <-> ${fullBracketed}::vector(1536)) as distance
      FROM candidates c
      JOIN pdr_ai_v2_document_context_chunks cc ON c.context_chunk_id = cc.id
      JOIN pdr_ai_v2_document d ON cc.document_id = d.id
      ORDER BY distance ASC
      LIMIT ${this.topK}
    `;

    const result = await db.execute<VectorRow>(sqlQuery);
    let rows = toRows<VectorRow>(result);

    // Fallback: Old Context Chunks Search
    if (rows.length === 0) {
      console.log(`[VectorRetriever] No retrieval chunks found, falling back to Context Chunks search`);

      let fallbackBaseWhere;
      if (this.searchScope === "document" && this.documentId !== undefined) {
        fallbackBaseWhere = sql`s.document_id = ${this.documentId}`;
      } else if (this.searchScope === "company") {
        fallbackBaseWhere = sql`d.company_id = ${this.companyId}`;
      } else if (this.searchScope === "multi-document" && this.documentIds?.length) {
        fallbackBaseWhere = sql`s.document_id = ANY(${`{${this.documentIds.join(",")}}`}::int[])`;
      }

      const fallbackFullWhere = sql`${fallbackBaseWhere} ${filterWhere}`;

      const fallbackQuery = sql`
        SELECT
          s.id as child_id,
          s.content as parent_content,
          s.content as child_content,
          s.page_number as page,
          s.document_id,
          d.title as document_title,
          s.embedding <-> ${fullBracketed}::vector(1536) AS distance
        FROM pdr_ai_v2_document_context_chunks s
        JOIN pdr_ai_v2_document d ON s.document_id = d.id
        LEFT JOIN pdr_ai_v2_document_metadata dm ON d.id = dm.document_id
        WHERE ${fallbackFullWhere}
        AND s.embedding IS NOT NULL
        ORDER BY s.embedding <-> ${fullBracketed}::vector(1536)
        LIMIT ${this.topK}
      `;

      const fallbackResult = await db.execute<VectorRow>(fallbackQuery);
      rows = toRows<VectorRow>(fallbackResult);
    }

    return rows;
  }
}

export function createDocumentVectorRetriever(
  documentId: number,
  companyId: number,
  embeddings: EmbeddingsProvider,
  topK = 8,
  filters?: SearchFilters
): VectorRetriever {
  return new VectorRetriever({
    documentId,
    companyId,
    embeddings,
    topK,
    searchScope: "document",
    filters,
  });
}

export function createCompanyVectorRetriever(
  companyId: number,
  embeddings: EmbeddingsProvider,
  topK = 10,
  filters?: SearchFilters
): VectorRetriever {
  return new VectorRetriever({
    companyId,
    embeddings,
    topK,
    searchScope: "company",
    filters,
  });
}

export function createMultiDocVectorRetriever(
  documentIds: number[],
  companyId: number,
  embeddings: EmbeddingsProvider,
  topK = 8,
  filters?: SearchFilters
): VectorRetriever {
  return new VectorRetriever({
    documentIds,
    companyId,
    embeddings,
    topK,
    searchScope: "multi-document",
    filters,
  });
}
