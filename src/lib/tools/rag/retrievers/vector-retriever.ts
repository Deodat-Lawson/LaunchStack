import { db, toRows } from "~/server/db/index";
import { sql } from "drizzle-orm";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import type { EmbeddingsProvider, SearchScope, SearchFilters } from "../types";

interface VectorRetrieverConfig extends BaseRetrieverInput {
  embeddings: EmbeddingsProvider;
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

export class VectorRetriever extends BaseRetriever {
  lc_namespace = ["rag", "retrievers", "vector"];

  private embeddings: EmbeddingsProvider;
  private topK: number;
  private searchScope: SearchScope;
  private documentId?: number;
  private companyId?: number;
  private documentIds?: number[];
  private filters?: SearchFilters;

  constructor(fields: VectorRetrieverFields) {
    super(fields);
    this.embeddings = fields.embeddings;
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
    _runManager?: CallbackManagerForRetrieverRun
  ): Promise<Document[]> {
    try {
      const fullEmbedding = await this.embeddings.embedQuery(query);
      const shortEmbedding = fullEmbedding.slice(0, 512);

      const fullBracketed = `[${fullEmbedding.join(",")}]`;
      const shortBracketed = `[${shortEmbedding.join(",")}]`;

      // 1. Try Parent-Child Retrieval (New Architecture)
      // let sqlQuery; // Removed unused declaration
      let baseWhere;

      if (this.searchScope === "document" && this.documentId !== undefined) {
        baseWhere = sql`rc.document_id = ${this.documentId}`;
      } else if (this.searchScope === "company" && this.companyId !== undefined) {
        baseWhere = sql`d.company_id = ${this.companyId}`;
      } else if (this.searchScope === "multi-document" && this.documentIds?.length) {
        baseWhere = sql`rc.document_id = ANY(${`{${this.documentIds.join(",")}}`}::int[])`;
      } else {
        return [];
      }

      // Version filter: only return chunks from the current version of each
      // document. Chunks from older versions stay indexed (so revert is O(1))
      // but must be hidden from RAG results.
      //
      // The `IS NULL` branches keep this safe during the Phase 1 rollout:
      //   - If d.current_version_id IS NULL, the document has not been
      //     backfilled yet — return all its chunks unfiltered.
      //   - If rc.version_id IS NULL, the chunk pre-dates Step 2 and the
      //     backfill hasn't populated it yet — also return it.
      // Once backfill + Step 2 have been running for a while, both columns
      // are always set and this degenerates to a strict equality filter.
      const versionFilter = sql` AND (
        d.current_version_id IS NULL
        OR rc.version_id IS NULL
        OR rc.version_id = d.current_version_id
      )`;

      // Add Metadata Filters
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
        // Topic tags filtering (using JSONB containment @>)
        if (this.filters.topicTags && this.filters.topicTags.length > 0) {
           const tagsJson = JSON.stringify(this.filters.topicTags);
           filterWhere = sql`${filterWhere} AND dm.topic_tags @> ${tagsJson}::jsonb`;
        }
      }

      const fullWhere = sql`${baseWhere}${versionFilter} ${filterWhere}`;

      // 2-Step Retrieval with Filters
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

      type VectorRow = {
        child_id: number;
        parent_content: string;
        child_content: string;
        page: number;
        document_id: number;
        document_title: string;
        distance: number;
      };

      const result = await db.execute<VectorRow>(sqlQuery);
      let rows = toRows<VectorRow>(result);

      // 2. Fallback: Old Context Chunks Search
      if (rows.length === 0) {
        console.log(`[VectorRetriever] No retrieval chunks found, falling back to Context Chunks search`);
        
        let fallbackBaseWhere;
        if (this.searchScope === "document" && this.documentId !== undefined) {
             fallbackBaseWhere = sql`s.document_id = ${this.documentId}`;
        } else if (this.searchScope === "company" && this.companyId !== undefined) {
             fallbackBaseWhere = sql`d.company_id = ${this.companyId}`;
        } else if (this.searchScope === "multi-document" && this.documentIds?.length) {
             fallbackBaseWhere = sql`s.document_id = ANY(${`{${this.documentIds.join(",")}}`}::int[])`;
        }

        // Same version filter semantics as the primary query above, but with
        // `s` (context chunks) as the chunk alias instead of `rc`.
        const fallbackVersionFilter = sql` AND (
          d.current_version_id IS NULL
          OR s.version_id IS NULL
          OR s.version_id = d.current_version_id
        )`;

        const fallbackFullWhere = sql`${fallbackBaseWhere}${fallbackVersionFilter} ${filterWhere}`;

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
        `✅ [VectorRetriever] Retrieved ${documents.length} chunks (scope: ${this.searchScope})`
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
  topK = 8,
  filters?: SearchFilters
): VectorRetriever {
  return new VectorRetriever({
    documentId,
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
  embeddings: EmbeddingsProvider,
  topK = 8,
  filters?: SearchFilters
): VectorRetriever {
  return new VectorRetriever({
    documentIds,
    embeddings,
    topK,
    searchScope: "multi-document",
    filters,
  });
}
