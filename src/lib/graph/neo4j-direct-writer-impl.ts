/**
 * Neo4jDirectWriter implementation — R5 (Direct Write Pipeline) + R6 (Entity Resolution)
 *
 * Design decisions:
 *
 * Dynamic relationship types (Challenge 1):
 *   Uses option (a): group-by-type, one UNWIND+MERGE query per distinct type.
 *   Rationale: proven pattern already in neo4j-sync.ts; LLM typically extracts 5–20 types
 *   per document so N round-trips is acceptable. APOC adds an external dependency and
 *   option (c) requires careful sanitization. The relType string is validated against
 *   /^[A-Z][A-Z0-9_]*$/ before interpolation to prevent Cypher injection.
 *
 * Entity resolution timing (Challenge 2):
 *   Uses option (b): per-document batch resolution after all entities are written.
 *   Rationale: option (a) (per-entity) adds 50+ vector queries per document to ingestion
 *   latency. Option (c) (deferred) leaves duplicates in the graph indefinitely. Option (b)
 *   catches same-document duplicates immediately and cross-document duplicates on the next
 *   ingestion of the later document — acceptable for query quality.
 */

import type { Session } from "neo4j-driver";
import { getNeo4jSession } from "~/lib/graph/neo4j-client";
import type {
  Neo4jDirectWriter,
  Neo4jDeleteResult,
  Neo4jDocumentGraphInput,
  Neo4jEntityInput,
  Neo4jMentionInput,
  Neo4jRelationshipInput,
} from "~/lib/graph/neo4j-direct-writer";

/** Validates a relationship type is safe to interpolate into Cypher. */
function isValidRelType(relType: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(relType);
}

export class Neo4jDirectWriterImpl implements Neo4jDirectWriter {
  // ─── R5: writeEntities ──────────────────────────────────────────────────────

  async writeEntities(
    entities: Neo4jEntityInput[],
    companyId: string,
  ): Promise<number> {
    if (entities.length === 0) return 0;
    let session: Session | null = null;
    try {
      session = getNeo4jSession();
      await session.run(
        `UNWIND $entities AS e
         MERGE (n:Entity {name: e.name, label: e.label, companyId: e.companyId})
         ON CREATE SET
           n.displayName  = e.displayName,
           n.confidence   = e.confidence,
           n.mentionCount = e.mentionCount,
           n.embedding    = e.embedding
         ON MATCH SET
           n.confidence   = e.confidence,
           n.mentionCount = e.mentionCount,
           n.embedding    = CASE WHEN e.embedding IS NOT NULL THEN e.embedding ELSE n.embedding END`,
        {
          entities: entities.map((e) => ({
            name: e.name,
            displayName: e.displayName,
            label: e.label,
            confidence: e.confidence,
            mentionCount: e.mentionCount,
            companyId,
            embedding: e.embedding ?? null,
          })),
        },
      );
      return entities.length;
    } catch (err) {
      console.warn("[Neo4jDirectWriter] writeEntities failed:", err instanceof Error ? err.message : err);
      return 0;
    } finally {
      await session?.close();
    }
  }

  // ─── R5: writeRelationships ─────────────────────────────────────────────────

  async writeRelationships(
    relationships: Neo4jRelationshipInput[],
    companyId: string,
  ): Promise<string[]> {
    if (relationships.length === 0) return [];

    // Group by relationType; skip invalid types
    const byType = new Map<string, typeof relationships>();
    for (const r of relationships) {
      if (!isValidRelType(r.relationType)) {
        console.warn(`[Neo4jDirectWriter] Skipping invalid relationType: "${r.relationType}"`);
        continue;
      }
      const bucket = byType.get(r.relationType) ?? [];
      bucket.push(r);
      byType.set(r.relationType, bucket);
    }

    if (byType.size === 0) return [];

    let session: Session | null = null;
    try {
      session = getNeo4jSession();
      for (const [relType, rels] of byType) {
        await session.run(
          `UNWIND $rels AS r
           MATCH (src:Entity {name: r.sourceName, label: r.sourceLabel, companyId: r.companyId})
           MATCH (tgt:Entity {name: r.targetName, label: r.targetLabel, companyId: r.companyId})
           MERGE (src)-[rel:${relType}]->(tgt)
           ON CREATE SET
             rel.weight        = r.weight,
             rel.evidenceCount = r.evidenceCount,
             rel.detail        = r.detail,
             rel.documentId    = r.documentId
           ON MATCH SET
             rel.weight        = r.weight,
             rel.evidenceCount = r.evidenceCount,
             rel.detail        = CASE WHEN r.detail IS NOT NULL THEN r.detail ELSE rel.detail END`,
          {
            rels: rels.map((r) => ({
              sourceName: r.sourceName,
              sourceLabel: r.sourceLabel,
              targetName: r.targetName,
              targetLabel: r.targetLabel,
              companyId,
              weight: r.weight,
              evidenceCount: r.evidenceCount,
              detail: r.detail ?? null,
              documentId: r.documentId,
            })),
          },
        );
      }
      return [...byType.keys()];
    } catch (err) {
      console.warn("[Neo4jDirectWriter] writeRelationships failed:", err instanceof Error ? err.message : err);
      return [];
    } finally {
      await session?.close();
    }
  }

  // ─── R5: writeMentions ──────────────────────────────────────────────────────

  async writeMentions(
    mentions: Neo4jMentionInput[],
    companyId: string,
  ): Promise<number> {
    if (mentions.length === 0) return 0;
    let session: Session | null = null;
    try {
      session = getNeo4jSession();
      // Ensure Section nodes exist
      await session.run(
        `UNWIND $mentions AS m
         MERGE (s:Section {id: m.sectionId, documentId: m.documentId})`,
        { mentions },
      );
      // Create MENTIONED_IN edges
      await session.run(
        `UNWIND $mentions AS m
         MATCH (e:Entity {name: m.entityName, label: m.entityLabel, companyId: m.companyId})
         MATCH (s:Section {id: m.sectionId, documentId: m.documentId})
         MERGE (e)-[r:MENTIONED_IN]->(s)
         ON CREATE SET r.confidence = m.confidence
         ON MATCH SET  r.confidence = m.confidence`,
        {
          mentions: mentions.map((m) => ({
            entityName: m.entityName,
            entityLabel: m.entityLabel,
            sectionId: m.sectionId,
            documentId: m.documentId,
            confidence: m.confidence,
            companyId,
          })),
        },
      );
      return mentions.length;
    } catch (err) {
      console.warn("[Neo4jDirectWriter] writeMentions failed:", err instanceof Error ? err.message : err);
      return 0;
    } finally {
      await session?.close();
    }
  }

  // ─── R5: writeDocumentGraph ─────────────────────────────────────────────────

  async writeDocumentGraph(
    doc: Neo4jDocumentGraphInput,
    companyId: string,
  ): Promise<void> {
    let session: Session | null = null;
    try {
      session = getNeo4jSession();

      // Document node
      await session.run(
        `MERGE (d:Document {id: $id, companyId: $companyId})
         ON CREATE SET d.name = $name, d.uploadedAt = $uploadedAt
         ON MATCH SET  d.name = $name, d.uploadedAt = $uploadedAt`,
        {
          id: doc.document.id,
          companyId,
          name: doc.document.name,
          uploadedAt: doc.document.uploadedAt,
        },
      );

      // CONTAINS edges to sections
      if (doc.sectionIds.length > 0) {
        await session.run(
          `UNWIND $sectionIds AS sid
           MATCH (d:Document {id: $docId, companyId: $companyId})
           MERGE (s:Section {id: sid, documentId: $docId})
           MERGE (d)-[:CONTAINS]->(s)`,
          { sectionIds: doc.sectionIds, docId: doc.document.id, companyId },
        );
      }

      // Topics (optional — R9 scope)
      if (doc.topics && doc.topics.length > 0) {
        for (const topic of doc.topics) {
          await session.run(
            `MERGE (t:Topic {name: $name, companyId: $companyId})
             ON CREATE SET t.embedding = $embedding
             ON MATCH SET  t.embedding = CASE WHEN $embedding IS NOT NULL THEN $embedding ELSE t.embedding END
             WITH t
             UNWIND $sectionIds AS sid
             MATCH (s:Section {id: sid, documentId: $docId})
             MERGE (s)-[:DISCUSSES]->(t)`,
            {
              name: topic.name,
              companyId,
              embedding: topic.embedding,
              sectionIds: topic.sectionIds,
              docId: doc.document.id,
            },
          );
        }
      }
    } catch (err) {
      console.warn("[Neo4jDirectWriter] writeDocumentGraph failed:", err instanceof Error ? err.message : err);
    } finally {
      await session?.close();
    }
  }

  // ─── R5: ensureIndexes ──────────────────────────────────────────────────────

  async ensureIndexes(): Promise<void> {
    let session: Session | null = null;
    try {
      session = getNeo4jSession();
      await session.run(
        `CREATE VECTOR INDEX \`entity-embeddings\` IF NOT EXISTS
         FOR (e:Entity) ON (e.embedding)
         OPTIONS {indexConfig: {
           \`vector.dimensions\`: 768,
           \`vector.similarity_function\`: 'cosine'
         }}`,
      );
    } catch (err) {
      console.warn("[Neo4jDirectWriter] ensureIndexes failed (non-fatal):", err instanceof Error ? err.message : err);
    } finally {
      await session?.close();
    }
  }

  // ─── deleteDocumentGraph (R15 — stub, not scoped for this spec) ──────────

  async deleteDocumentGraph(
    _documentId: number,
    _companyId: string,
  ): Promise<Neo4jDeleteResult> {
    // R15 (Graph Deletion Pipeline) is a separate sub-spec. This stub satisfies
    // the interface contract; the real implementation comes in the R15 sub-spec.
    console.warn("[Neo4jDirectWriter] deleteDocumentGraph is not yet implemented (R15 scope)");
    return {
      deletedSections: 0,
      deletedMentions: 0,
      deletedRelationships: 0,
      orphanedEntitiesRemoved: 0,
      orphanedTopicsRemoved: 0,
      entitiesUpdated: 0,
      durationMs: 0,
    };
  }

  // ─── R6: resolveEntities ────────────────────────────────────────────────────
  // Not part of the Neo4jDirectWriter interface — called externally after writeEntities.

  async resolveEntities(
    entities: Neo4jEntityInput[],
    companyId: string,
  ): Promise<void> {
    const raw = process.env.ENTITY_RESOLUTION_THRESHOLD;
    const threshold = raw != null && raw !== "" ? parseFloat(raw) : 0.85;

    const entitiesWithEmbeddings = entities.filter((e) => e.embedding && e.embedding.length > 0);
    if (entitiesWithEmbeddings.length === 0) return;

    let session: Session | null = null;
    try {
      session = getNeo4jSession();

      for (const entity of entitiesWithEmbeddings) {
        let candidates: Array<{ name: string; label: string; mentionCount: number; score: number }>;
        try {
          const result = await session.run(
            `CALL db.index.vector.queryNodes('entity-embeddings', 10, $embedding)
             YIELD node, score
             WHERE node.companyId = $companyId
               AND node.name <> $name
               AND score >= $threshold
             RETURN node.name AS name, node.label AS label, node.mentionCount AS mentionCount, score
             ORDER BY score DESC`,
            {
              embedding: entity.embedding,
              companyId,
              name: entity.name,
              threshold,
            },
          );
          candidates = result.records.map((r) => ({
            name: r.get("name") as string,
            label: r.get("label") as string,
            mentionCount: r.get("mentionCount") as number,
            score: r.get("score") as number,
          }));
        } catch (err) {
          console.warn("[Neo4jDirectWriter] Vector index query failed (skipping resolution):", err instanceof Error ? err.message : err);
          return;
        }

        for (const candidate of candidates) {
          // Determine canonical: higher mentionCount wins; tie → existing node (candidate) is canonical
          const entityMentionCount = entity.mentionCount;
          const isEntityCanonical = entityMentionCount > candidate.mentionCount;

          if (isEntityCanonical) {
            // entity is canonical, candidate is alias
            await session.run(
              `MATCH (alias:Entity {name: $aliasName, label: $aliasLabel, companyId: $companyId})
               MATCH (canonical:Entity {name: $canonicalName, label: $canonicalLabel, companyId: $companyId})
               MERGE (alias)-[:ALIAS_OF]->(canonical)`,
              {
                aliasName: candidate.name,
                aliasLabel: candidate.label,
                canonicalName: entity.name,
                canonicalLabel: entity.label,
                companyId,
              },
            );
          } else {
            // candidate is canonical (higher or equal mentionCount → existing wins on tie)
            await session.run(
              `MATCH (alias:Entity {name: $aliasName, label: $aliasLabel, companyId: $companyId})
               MATCH (canonical:Entity {name: $canonicalName, label: $canonicalLabel, companyId: $companyId})
               MERGE (alias)-[:ALIAS_OF]->(canonical)`,
              {
                aliasName: entity.name,
                aliasLabel: entity.label,
                canonicalName: candidate.name,
                canonicalLabel: candidate.label,
                companyId,
              },
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("index") || msg.includes("vector")) {
        console.warn("[Neo4jDirectWriter] Vector index not available, skipping entity resolution:", msg);
      } else {
        console.warn("[Neo4jDirectWriter] resolveEntities failed:", msg);
      }
    } finally {
      await session?.close();
    }
  }
}
