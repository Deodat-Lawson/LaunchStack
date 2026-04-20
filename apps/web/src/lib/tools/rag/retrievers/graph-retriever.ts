/**
 * Graph Retriever
 *
 * Extends LangChain BaseRetriever to find relevant document sections
 * by traversing the knowledge graph. Used alongside VectorRetriever
 * and BM25Retriever in the ensemble search.
 *
 * Flow:
 * 1. Extract entity names from the user query (simple keyword matching or NER)
 * 2. Find matching entities in the knowledge graph
 * 3. Traverse 1-2 hops to find related entities
 * 4. Collect all document sections where matched entities are mentioned
 * 5. Return as LangChain Documents
 */

import { db } from "~/server/db/index";
import { eq, inArray, and, or, ilike } from "drizzle-orm";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import {
  kgEntities,
  kgEntityMentions,
  kgRelationships,
  documentSections,
} from "~/server/db/schema";

// ============================================================================
// Config
// ============================================================================

interface GraphRetrieverConfig extends BaseRetrieverInput {
  companyId: number;
  maxHops?: number;
  topK?: number;
  documentIds?: number[];
}

// ============================================================================
// GraphRetriever
// ============================================================================

export class GraphRetriever extends BaseRetriever {
  lc_namespace = ["rag", "retrievers", "graph"];

  private companyId: number;
  private maxHops: number;
  private topK: number;
  private documentIds?: number[];

  constructor(config: GraphRetrieverConfig) {
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
      `[GraphRetriever] Query: "${query.substring(0, 80)}...", companyId=${this.companyId}, ` +
      `maxHops=${this.maxHops}, topK=${this.topK}, docFilter=${this.documentIds?.length ?? "all"}`
    );

    // Step 1: Extract candidate entity names from query
    const queryTerms = this.extractQueryTerms(query);
    console.log(`[GraphRetriever] Step 1: Extracted ${queryTerms.length} query terms: [${queryTerms.slice(0, 10).join(", ")}]`);

    if (queryTerms.length === 0) {
      console.log("[GraphRetriever] No query terms extracted, returning empty");
      return [];
    }

    // Step 2: Find matching entities in the KG
    const step2Start = Date.now();
    const matchedEntityIds = await this.findMatchingEntities(queryTerms);
    console.log(`[GraphRetriever] Step 2: Found ${matchedEntityIds.length} matching entities (${Date.now() - step2Start}ms)`);

    if (matchedEntityIds.length === 0) {
      console.log("[GraphRetriever] No entity matches, returning empty");
      return [];
    }

    // Step 3: Expand via graph traversal (1-2 hops)
    const allEntityIds = new Set(matchedEntityIds);
    const step3Start = Date.now();

    for (let hop = 0; hop < this.maxHops; hop++) {
      const prevSize = allEntityIds.size;
      const neighbors = await this.getNeighborEntities([...allEntityIds]);
      for (const id of neighbors) {
        allEntityIds.add(id);
      }
      console.log(`[GraphRetriever] Step 3: Hop ${hop + 1} expanded ${prevSize} → ${allEntityIds.size} entities (+${neighbors.length} neighbors)`);
    }
    console.log(`[GraphRetriever] Step 3: Total entity expansion: ${matchedEntityIds.length} → ${allEntityIds.size} (${Date.now() - step3Start}ms)`);

    // Step 4: Get sections where these entities are mentioned
    const step4Start = Date.now();
    const sectionIds = await this.getSectionIdsForEntities([...allEntityIds]);
    console.log(`[GraphRetriever] Step 4: Found ${sectionIds.length} section IDs (${Date.now() - step4Start}ms)`);

    if (sectionIds.length === 0) {
      console.log("[GraphRetriever] No sections found for matched entities, returning empty");
      return [];
    }

    // Step 5: Fetch actual section content
    const sections = await this.fetchSections(sectionIds);

    const totalMs = Date.now() - startTime;
    console.log(
      `[GraphRetriever] Done (${totalMs}ms): ${matchedEntityIds.length} matched → ` +
      `${allEntityIds.size} expanded → ${sectionIds.length} section IDs → ${sections.length} documents returned`,
    );

    return sections;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Simple keyword extraction from the query.
   * Extracts words that are likely entity names (capitalised, multi-word, etc.)
   */
  private extractQueryTerms(query: string): string[] {
    // Split into words, keep meaningful terms (3+ chars)
    const words = query
      .replace(/[?!.,;:'"()[\]{}]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.toLowerCase());

    // Deduplicate
    return [...new Set(words)];
  }

  /**
   * Find entities in the KG that match any of the query terms.
   */
  private async findMatchingEntities(terms: string[]): Promise<number[]> {
    if (terms.length === 0) return [];

    // Build OR conditions for fuzzy name matching
    const conditions = terms.map((term) =>
      ilike(kgEntities.name, `%${term}%`),
    );

    const results = await db
      .select({ id: kgEntities.id })
      .from(kgEntities)
      .where(
        and(
          eq(kgEntities.companyId, BigInt(this.companyId)),
          or(...conditions),
        ),
      )
      .limit(50); // Cap to avoid explosion

    return results.map((r) => r.id);
  }

  /**
   * Get entity IDs that are connected to the given entities via relationships.
   */
  private async getNeighborEntities(entityIds: number[]): Promise<number[]> {
    if (entityIds.length === 0) return [];

    const outgoing = await db
      .select({ id: kgRelationships.targetEntityId })
      .from(kgRelationships)
      .where(inArray(kgRelationships.sourceEntityId, entityIds));

    const incoming = await db
      .select({ id: kgRelationships.sourceEntityId })
      .from(kgRelationships)
      .where(inArray(kgRelationships.targetEntityId, entityIds));

    const ids = new Set<number>();
    for (const r of outgoing) ids.add(r.id);
    for (const r of incoming) ids.add(r.id);

    return [...ids];
  }

  /**
   * Get document section IDs where any of the given entities are mentioned.
   */
  private async getSectionIdsForEntities(
    entityIds: number[],
  ): Promise<number[]> {
    if (entityIds.length === 0) return [];

    const query = db
      .select({ sectionId: kgEntityMentions.sectionId })
      .from(kgEntityMentions)
      .where(inArray(kgEntityMentions.entityId, entityIds));

    const results = await query;

    // Deduplicate and limit
    const uniqueIds = [...new Set(results.map((r) => r.sectionId))];
    return uniqueIds.slice(0, this.topK * 2); // Fetch extra, we'll trim later
  }

  /**
   * Fetch section content and convert to LangChain Documents.
   */
  private async fetchSections(sectionIds: number[]): Promise<Document[]> {
    if (sectionIds.length === 0) return [];

    let whereClause = inArray(documentSections.id, sectionIds);

    // Optionally restrict to specific documents
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
            source: "graph_retriever",
            searchScope: "multi-document",
            retrievalMethod: "graph_traversal",
          },
        }),
    );
  }
}

// ============================================================================
// Factory functions
// ============================================================================

export function createGraphRetriever(
  companyId: number,
  options?: {
    documentIds?: number[];
    maxHops?: number;
    topK?: number;
  },
): GraphRetriever {
  return new GraphRetriever({
    companyId,
    documentIds: options?.documentIds,
    maxHops: options?.maxHops,
    topK: options?.topK,
  });
}
