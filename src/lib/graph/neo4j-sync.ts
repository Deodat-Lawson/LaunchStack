/**
 * Neo4j Sync
 *
 * After entity extraction writes to PostgreSQL, this module reads
 * the extracted entities, mentions, and relationships for a given
 * document and syncs them into Neo4j using idempotent MERGE queries.
 *
 * Neo4j stores lightweight graph structure (entity names, labels,
 * section IDs). Full section content stays in PostgreSQL.
 */

import type { Session } from "neo4j-driver";
import { db } from "~/server/db";
import {
  kgEntities,
  kgEntityMentions,
  kgRelationships,
} from "~/server/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getNeo4jSession } from "./neo4j-client";

interface SyncResult {
  entities: number;
  mentions: number;
  relationships: number;
  dynamicRelTypes: string[];
  durationMs: number;
}

/**
 * Sync all entities, mentions, and relationships for a single document
 * from PostgreSQL into Neo4j.
 */
export async function syncDocumentToNeo4j(
  documentId: number,
  companyId: bigint,
): Promise<SyncResult> {
  const start = Date.now();

  const mentions = await db
    .select({
      entityId: kgEntityMentions.entityId,
      sectionId: kgEntityMentions.sectionId,
      confidence: kgEntityMentions.confidence,
    })
    .from(kgEntityMentions)
    .where(eq(kgEntityMentions.documentId, BigInt(documentId)));

  if (mentions.length === 0) {
    console.log(`[Neo4jSync] No mentions for document ${documentId}, skipping`);
    return { entities: 0, mentions: 0, relationships: 0, dynamicRelTypes: [], durationMs: 0 };
  }

  const entityIds = [...new Set(mentions.map((m) => m.entityId))];

  const entities = await db
    .select({
      id: kgEntities.id,
      name: kgEntities.name,
      displayName: kgEntities.displayName,
      label: kgEntities.label,
      confidence: kgEntities.confidence,
      mentionCount: kgEntities.mentionCount,
      embedding: kgEntities.embedding,
    })
    .from(kgEntities)
    .where(inArray(kgEntities.id, entityIds));

  const relationships = await db
    .select({
      sourceEntityId: kgRelationships.sourceEntityId,
      targetEntityId: kgRelationships.targetEntityId,
      relationshipType: kgRelationships.relationshipType,
      weight: kgRelationships.weight,
      evidenceCount: kgRelationships.evidenceCount,
      detail: kgRelationships.detail,
    })
    .from(kgRelationships)
    .where(
      and(
        eq(kgRelationships.documentId, BigInt(documentId)),
        eq(kgRelationships.companyId, companyId),
      ),
    );

  const entityById = new Map(entities.map((e) => [e.id, e]));

  let session: Session | null = null;
  try {
    session = getNeo4jSession();

    await syncEntities(session, entities, companyId);
    await syncSectionsAndMentions(session, mentions, entityById, documentId, companyId);
    const dynamicRelTypes = await syncRelationships(session, relationships, entityById, companyId, documentId);

    // Create vector index for entity embeddings (idempotent)
    await ensureVectorIndex(session);

    const durationMs = Date.now() - start;
    console.log(
      `[Neo4jSync] Document ${documentId}: synced ${entities.length} entities, ` +
      `${mentions.length} mentions, ${relationships.length} relationships ` +
      `(${dynamicRelTypes.length} types: ${dynamicRelTypes.join(", ")}) (${durationMs}ms)`,
    );

    return {
      entities: entities.length,
      mentions: mentions.length,
      relationships: relationships.length,
      dynamicRelTypes,
      durationMs,
    };
  } finally {
    await session?.close();
  }
}

async function syncEntities(
  session: Session,
  entities: {
    id: number;
    name: string;
    displayName: string;
    label: string;
    confidence: number;
    mentionCount: number;
    embedding: number[] | null;
  }[],
  companyId: bigint,
): Promise<void> {
  if (entities.length === 0) return;

  const params = entities.map((e) => ({
    name: e.name,
    displayName: e.displayName,
    label: e.label,
    confidence: e.confidence,
    mentionCount: e.mentionCount,
    companyId: companyId.toString(),
    embedding: e.embedding ?? null,
  }));

  await session.run(
    `UNWIND $entities AS e
     MERGE (n:Entity {name: e.name, label: e.label, companyId: e.companyId})
     ON CREATE SET n.displayName = e.displayName,
                   n.confidence = e.confidence,
                   n.mentionCount = e.mentionCount,
                   n.embedding = e.embedding
     ON MATCH SET  n.confidence = e.confidence,
                   n.mentionCount = e.mentionCount,
                   n.embedding = CASE WHEN e.embedding IS NOT NULL THEN e.embedding ELSE n.embedding END`,
    { entities: params },
  );
}

async function syncSectionsAndMentions(
  session: Session,
  mentions: { entityId: number; sectionId: number; confidence: number }[],
  entityById: Map<number, { name: string; label: string }>,
  documentId: number,
  companyId: bigint,
): Promise<void> {
  if (mentions.length === 0) return;

  const sectionIds = [...new Set(mentions.map((m) => m.sectionId))];
  const sectionParams = sectionIds.map((id) => ({
    sectionId: id,
    documentId,
  }));

  await session.run(
    `UNWIND $sections AS s
     MERGE (sec:Section {id: s.sectionId, documentId: s.documentId})`,
    { sections: sectionParams },
  );

  const mentionParams = mentions
    .filter((m) => entityById.has(m.entityId))
    .map((m) => {
      const ent = entityById.get(m.entityId)!;
      return {
        entityName: ent.name,
        entityLabel: ent.label,
        companyId: companyId.toString(),
        sectionId: m.sectionId,
        documentId,
        confidence: m.confidence,
      };
    });

  await session.run(
    `UNWIND $mentions AS m
     MATCH (e:Entity {name: m.entityName, label: m.entityLabel, companyId: m.companyId})
     MATCH (s:Section {id: m.sectionId, documentId: m.documentId})
     MERGE (e)-[r:MENTIONED_IN]->(s)
     ON CREATE SET r.confidence = m.confidence
     ON MATCH SET  r.confidence = m.confidence`,
    { mentions: mentionParams },
  );
}

async function syncRelationships(
  session: Session,
  relationships: {
    sourceEntityId: number;
    targetEntityId: number;
    relationshipType: string;
    weight: number;
    evidenceCount: number;
    detail: string | null;
  }[],
  entityById: Map<number, { name: string; label: string }>,
  companyId: bigint,
  documentId: number,
): Promise<string[]> {
  if (relationships.length === 0) return [];

  const relParams = relationships
    .filter(
      (r) => entityById.has(r.sourceEntityId) && entityById.has(r.targetEntityId),
    )
    .map((r) => {
      const src = entityById.get(r.sourceEntityId)!;
      const tgt = entityById.get(r.targetEntityId)!;
      return {
        srcName: src.name,
        srcLabel: src.label,
        tgtName: tgt.name,
        tgtLabel: tgt.label,
        companyId: companyId.toString(),
        relType: r.relationshipType,
        weight: r.weight,
        evidenceCount: r.evidenceCount,
        detail: r.detail ?? null,
        documentId,
      };
    });

  // Neo4j doesn't support dynamic relationship types in MERGE,
  // so we group by type and run one query per type.
  const byType = new Map<string, typeof relParams>();
  for (const p of relParams) {
    const existing = byType.get(p.relType) ?? [];
    existing.push(p);
    byType.set(p.relType, existing);
  }

  for (const [relType, params] of byType) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (src:Entity {name: r.srcName, label: r.srcLabel, companyId: r.companyId})
       MATCH (tgt:Entity {name: r.tgtName, label: r.tgtLabel, companyId: r.companyId})
       MERGE (src)-[rel:${relType}]->(tgt)
       ON CREATE SET rel.weight = r.weight,
                     rel.evidenceCount = r.evidenceCount,
                     rel.detail = r.detail,
                     rel.documentId = r.documentId
       ON MATCH SET  rel.weight = r.weight,
                     rel.evidenceCount = r.evidenceCount,
                     rel.detail = CASE WHEN r.detail IS NOT NULL THEN r.detail ELSE rel.detail END`,
      { rels: params },
    );
  }

  return [...byType.keys()];
}

/**
 * Ensure the Neo4j vector index for entity embeddings exists.
 * Idempotent — uses IF NOT EXISTS.
 */
async function ensureVectorIndex(session: Session): Promise<void> {
  try {
    await session.run(
      `CREATE VECTOR INDEX \`entity-embeddings\` IF NOT EXISTS
       FOR (e:Entity) ON (e.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 768,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    );
  } catch (error) {
    // Non-fatal — index creation may fail on Neo4j Community without GDS plugin
    console.warn(
      "[Neo4jSync] Vector index creation skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}
