/**
 * Neo4j Graph Retriever
 *
 * Extends LangChain BaseRetriever to find relevant document sections
 * by traversing the Neo4j knowledge graph via Cypher queries.
 * Falls back to the PostgreSQL GraphRetriever when Neo4j is unavailable.
 *
 * Flow:
 * 1. Extract query terms from the user question
 * 2. Match entities in Neo4j by name (fuzzy CONTAINS)
 * 3. Traverse 1-2 hops via CO_OCCURS relationships
 * 4. Collect section IDs via MENTIONED_IN edges
 * 5. Fetch section content from PostgreSQL (Neo4j only stores IDs)
 * 6. Return as LangChain Documents
 */

import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import { db } from "~/server/db/index";
import { documentSections } from "~/server/db/schema";
import { inArray, and } from "drizzle-orm";
import { isNeo4jConfigured, getNeo4jSession } from "~/lib/graph/neo4j-client";
import neo4j, { type Session } from "neo4j-driver";

interface Neo4jGraphRetrieverConfig extends BaseRetrieverInput {
  companyId: number;
  maxHops?: number;
  topK?: number;
  documentIds?: number[];
}

export class Neo4jGraphRetriever extends BaseRetriever {
  lc_namespace = ["rag", "retrievers", "neo4j-graph"];

  private companyId: number;
  private maxHops: number;
  private topK: number;
  private documentIds?: number[];

  constructor(config: Neo4jGraphRetrieverConfig) {
    super(config);
    this.companyId = config.companyId;
    this.maxHops = config.maxHops ?? 1;
    this.topK = config.topK ?? 10;
    this.documentIds = config.documentIds;
  }

  async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun,
  ): Promise<Document[]> {
    const startTime = Date.now();
    console.log(
      `[Neo4jGraphRetriever] Query: "${query.substring(0, 80)}...", ` +
        `companyId=${this.companyId}, maxHops=${this.maxHops}, topK=${this.topK}`,
    );

    const queryTerms = this.extractQueryTerms(query);
    console.log(
      `[Neo4jGraphRetriever] Extracted ${queryTerms.length} query terms: [${queryTerms.slice(0, 10).join(", ")}]`,
    );

    if (queryTerms.length === 0) {
      console.log("[Neo4jGraphRetriever] No query terms, returning empty");
      return [];
    }

    let session: Session | null = null;
    try {
      session = getNeo4jSession();

      const sectionIds = await this.findSectionsViaCypher(
        session,
        queryTerms,
      );

      console.log(
        `[Neo4jGraphRetriever] Cypher returned ${sectionIds.length} section IDs`,
      );

      if (sectionIds.length === 0) {
        console.log("[Neo4jGraphRetriever] No sections found, returning empty");
        return [];
      }

      const docs = await this.fetchSectionsFromPostgres(sectionIds);

      const elapsed = Date.now() - startTime;
      console.log(
        `[Neo4jGraphRetriever] Done (${elapsed}ms): ${queryTerms.length} terms -> ` +
          `${sectionIds.length} section IDs -> ${docs.length} documents returned`,
      );

      return docs;
    } catch (error) {
      console.error(
        "[Neo4jGraphRetriever] Cypher query failed:",
        error instanceof Error ? error.message : error,
      );
      return [];
    } finally {
      await session?.close();
    }
  }

  private extractQueryTerms(query: string): string[] {
    const words = query
      .replace(/[?!.,;:'"()[\]{}]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.toLowerCase());

    return [...new Set(words)];
  }

  private async findSectionsViaCypher(
    session: Session,
    terms: string[],
  ): Promise<number[]> {
    const companyId = this.companyId.toString();
    const hops = this.maxHops;
    const limit = this.topK * 2;

    // Step 1: Find entities matching query terms
    // Step 2: Traverse CO_OCCURS up to maxHops
    // Step 3: Collect section IDs via MENTIONED_IN
    const result = await session.run(
      `
      UNWIND $terms AS term
      MATCH (e:Entity {companyId: $companyId})
      WHERE toLower(e.name) CONTAINS term
      WITH COLLECT(DISTINCT e) AS directEntities

      // Expand via CO_OCCURS hops
      UNWIND directEntities AS de
      CALL {
        WITH de
        MATCH (de)-[:CO_OCCURS*0..${hops}]-(neighbor:Entity {companyId: $companyId})
        RETURN DISTINCT neighbor
      }
      WITH COLLECT(DISTINCT neighbor) AS allEntities

      // Get sections
      UNWIND allEntities AS ent
      MATCH (ent)-[:MENTIONED_IN]->(s:Section)
      ${this.documentIds && this.documentIds.length > 0 ? "WHERE s.documentId IN $documentIds" : ""}
      RETURN DISTINCT s.id AS sectionId
      LIMIT $limit
      `,
      {
        terms,
        companyId,
        limit: neo4j.int(limit),
        ...(this.documentIds && this.documentIds.length > 0
          ? { documentIds: this.documentIds }
          : {}),
      },
    );

    return result.records.map((r) => {
      const val = r.get("sectionId") as
        | number
        | { toNumber: () => number };
      return typeof val === "object" && "toNumber" in val
        ? val.toNumber()
        : Number(val);
    });
  }

  private async fetchSectionsFromPostgres(
    sectionIds: number[],
  ): Promise<Document[]> {
    if (sectionIds.length === 0) return [];

    let whereClause = inArray(documentSections.id, sectionIds);

    if (this.documentIds && this.documentIds.length > 0) {
      const docBigInts = this.documentIds.map((id) => BigInt(id));
      whereClause = and(
        whereClause,
        inArray(documentSections.documentId, docBigInts),
      )!;
    }

    const rows = await db
      .select({
        id: documentSections.id,
        content: documentSections.content,
        pageNumber: documentSections.pageNumber,
        documentId: documentSections.documentId,
      })
      .from(documentSections)
      .where(whereClause)
      .limit(this.topK);

    return rows.map(
      (row) =>
        new Document({
          pageContent: row.content,
          metadata: {
            chunkId: row.id,
            page: row.pageNumber,
            documentId: Number(row.documentId),
            source: "neo4j_graph_retriever",
            searchScope: "multi-document",
            retrievalMethod: "graph_traversal",
          },
        }),
    );
  }
}

export function createNeo4jGraphRetriever(
  companyId: number,
  options?: {
    documentIds?: number[];
    maxHops?: number;
    topK?: number;
  },
): Neo4jGraphRetriever {
  return new Neo4jGraphRetriever({
    companyId,
    documentIds: options?.documentIds,
    maxHops: options?.maxHops,
    topK: options?.topK,
  });
}

/**
 * Returns true if Neo4j graph retrieval should be used.
 */
export function shouldUseNeo4jRetriever(): boolean {
  return (
    isNeo4jConfigured() &&
    (process.env.ENABLE_GRAPH_RETRIEVER === "true" ||
      process.env.ENABLE_GRAPH_RETRIEVER === "1")
  );
}
