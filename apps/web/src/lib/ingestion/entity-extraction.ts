/**
 * Entity Extraction Client
 *
 * Calls the sidecar's /extract-entities endpoint and stores
 * the results in the knowledge graph tables.
 */

import { db } from "~/server/db";
import {
  kgEntities,
  kgEntityMentions,
  kgRelationships,
  entityLabelEnum,
  type EntityLabel,
  type RelationshipType,
} from "@launchstack/core/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getNERProvider } from "~/lib/providers/ner";
import { debitTokens } from "~/lib/credits";
import { isCloudMode } from "~/lib/providers/registry";

function isEntityLabel(s: string): s is EntityLabel {
  return (entityLabelEnum as readonly string[]).includes(s);
}

// ============================================================================
// Extract + Store
// ============================================================================

/**
 * Extract entities from chunks via the sidecar and persist them
 * in the knowledge graph tables.
 *
 * @param chunks - Array of { sectionId, content } pairs
 * @param documentId - The document these chunks belong to
 * @param companyId - Company scope for the entities
 */
export async function extractAndStoreEntities(
  chunks: { sectionId: number; content: string }[],
  documentId: number,
  companyId: bigint,
): Promise<{ totalEntities: number; totalRelationships: number }> {
  if (chunks.length === 0) {
    return { totalEntities: 0, totalRelationships: 0 };
  }

  // 1. Call provider (LLM-based NER or sidecar)
  const provider = await getNERProvider();
  console.log(`[EntityExtraction] Using ${provider.name} for ${chunks.length} chunks`);

  const { data, usage } = await provider.extract(chunks.map((c) => c.content));

  // Debit credits if cloud mode
  if (isCloudMode() && usage.tokensUsed > 0) {
    await debitTokens({
      companyId,
      amount: usage.tokensUsed,
      service: "ner",
      description: `NER extraction for ${chunks.length} chunks via ${provider.name}`,
      referenceId: String(documentId),
      metadata: usage.details,
    }).catch((err) => {
      console.warn("[EntityExtraction] Credit debit failed (non-blocking):", err);
    });
  }

  let totalEntities = 0;
  let totalRelationships = 0;

  // 2. Process each chunk's entities
  for (let i = 0; i < data.results.length; i++) {
    const chunkResult = data.results[i]!;
    const sectionId = chunks[i]!.sectionId;
    const entityIdsInChunk: number[] = [];

    for (const ent of chunkResult.entities) {
      const normalizedName = ent.text.toLowerCase().trim();
      if (normalizedName.length < 2) continue;
      if (!isEntityLabel(ent.label)) continue;

      // Upsert entity
      const entityId = await upsertEntity(
        normalizedName,
        ent.text,
        ent.label,
        ent.score,
        companyId,
      );

      // Create mention link
      await upsertMention(entityId, sectionId, documentId, ent.score);

      entityIdsInChunk.push(entityId);
      totalEntities++;
    }

    // 3. Create CO_OCCURS relationships between entities in the same chunk
    for (let a = 0; a < entityIdsInChunk.length; a++) {
      for (let b = a + 1; b < entityIdsInChunk.length; b++) {
        await upsertRelationship(
          entityIdsInChunk[a]!,
          entityIdsInChunk[b]!,
          "CO_OCCURS",
          documentId,
          companyId,
        );
        totalRelationships++;
      }
    }
  }

  console.log(
    `[EntityExtraction] Stored ${totalEntities} entities and ${totalRelationships} relationships for document ${documentId}`,
  );

  return { totalEntities, totalRelationships };
}

// ============================================================================
// Upsert Helpers
// ============================================================================

async function upsertEntity(
  normalizedName: string,
  displayName: string,
  label: EntityLabel,
  confidence: number,
  companyId: bigint,
): Promise<number> {
  // Try to find existing entity
  const [existing] = await db
    .select({ id: kgEntities.id })
    .from(kgEntities)
    .where(
      and(
        eq(kgEntities.name, normalizedName),
        eq(kgEntities.label, label),
        eq(kgEntities.companyId, companyId),
      ),
    )
    .limit(1);

  if (existing) {
    // Update mention count and running average confidence
    await db
      .update(kgEntities)
      .set({
        mentionCount: sql`${kgEntities.mentionCount} + 1`,
        confidence: sql`(${kgEntities.confidence} * ${kgEntities.mentionCount} + ${confidence}) / (${kgEntities.mentionCount} + 1)`,
      })
      .where(eq(kgEntities.id, existing.id));
    return existing.id;
  }

  // Insert new entity
  const [inserted] = await db
    .insert(kgEntities)
    .values({
      name: normalizedName,
      displayName,
      label,
      confidence,
      mentionCount: 1,
      companyId,
    })
    .returning({ id: kgEntities.id });

  return inserted!.id;
}

async function upsertMention(
  entityId: number,
  sectionId: number,
  documentId: number,
  confidence: number,
): Promise<void> {
  // Insert ignore on conflict (entity+section unique)
  await db
    .insert(kgEntityMentions)
    .values({
      entityId,
      sectionId,
      documentId: BigInt(documentId),
      confidence,
    })
    .onConflictDoNothing();
}

async function upsertRelationship(
  sourceId: number,
  targetId: number,
  type: RelationshipType,
  documentId: number,
  companyId: bigint,
): Promise<void> {
  // Normalise direction: always store smaller ID as source
  const [src, tgt] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];

  const [existing] = await db
    .select({ id: kgRelationships.id })
    .from(kgRelationships)
    .where(
      and(
        eq(kgRelationships.sourceEntityId, src),
        eq(kgRelationships.targetEntityId, tgt),
        eq(kgRelationships.relationshipType, type),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(kgRelationships)
      .set({
        evidenceCount: sql`${kgRelationships.evidenceCount} + 1`,
        weight: sql`LEAST(1.0, ${kgRelationships.weight} + 0.1)`,
      })
      .where(eq(kgRelationships.id, existing.id));
    return;
  }

  await db.insert(kgRelationships).values({
    sourceEntityId: src,
    targetEntityId: tgt,
    relationshipType: type,
    weight: 0.5,
    evidenceCount: 1,
    documentId: BigInt(documentId),
    companyId,
  });
}
