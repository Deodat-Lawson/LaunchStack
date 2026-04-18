import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// SIDECAR API SCHEMAS
// ═══════════════════════════════════════════════════════════════

// ── BERT Entity (base, without embedding) ────────────────────

export const EntityBaseSchema = z.object({
    text: z.string().min(1),
    label: z.string().min(1),
    score: z.number().min(0).max(1),
});

// ── BERT Entity (with CLS embedding) ────────────────────────

export const EntityWithEmbeddingSchema = EntityBaseSchema.extend({
    embedding: z.array(z.number()).length(768),
});

// ── Extract Entities Response (base, backward compatible) ────

export const ExtractEntitiesResponseSchema = z.object({
    results: z.array(
        z.object({
            text: z.string(),
            entities: z.array(EntityBaseSchema),
        })
    ),
    total_entities: z.number().int().nonnegative(),
});

// ── Extract Entities Enhanced Response (with embeddings) ─────

export const ExtractEntitiesEnhancedResponseSchema = z.object({
    results: z.array(
        z.object({
            text: z.string(),
            entities: z.array(EntityWithEmbeddingSchema),
        })
    ),
    total_entities: z.number().int().nonnegative(),
});

// ── Extraction Entity (LLM-extracted, model-agnostic) ────────

export const ExtractionEntitySchema = z.object({
    name: z.string().min(1),
    type: z.enum(["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"]),
});

// ── Extraction Relationship ──────────────────────────────────

export const ExtractionRelationshipSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/), // SCREAMING_SNAKE_CASE
    detail: z.string(),
});

// ── Extraction Chunk Result ──────────────────────────────────

export const ExtractionChunkResultSchema = z.object({
    text: z.string(),
    entities: z.array(ExtractionEntitySchema),
    relationships: z.array(ExtractionRelationshipSchema),
    dropped_relationships: z.array(ExtractionRelationshipSchema),
});

// ── Extract Relationships Response ───────────────────────────

export const ExtractRelationshipsResponseSchema = z.object({
    results: z.array(ExtractionChunkResultSchema),
    total_entities: z.number().int().nonnegative(),
    total_relationships: z.number().int().nonnegative(),
    total_dropped: z.number().int().nonnegative(),
});

// ═══════════════════════════════════════════════════════════════
// NEO4J DATA SHAPE SCHEMAS
// ═══════════════════════════════════════════════════════════════

// ── Neo4j Entity Node ────────────────────────────────────────

export const Neo4jEntityNodeSchema = z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    label: z.string().min(1),
    confidence: z.number().min(0).max(1),
    mentionCount: z.number().int().positive(),
    companyId: z.string().min(1),
    embedding: z.array(z.number()).length(768).nullable(),
});

// ── Neo4j Section Node ───────────────────────────────────────

export const Neo4jSectionNodeSchema = z.object({
    id: z.number().int().positive(),
    documentId: z.number().int().positive(),
});

// ── Neo4j Document Node ──────────────────────────────────────

export const Neo4jDocumentNodeSchema = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    companyId: z.string().min(1),
    uploadedAt: z.string().min(1),
});

// ── Neo4j Topic Node ─────────────────────────────────────────

export const Neo4jTopicNodeSchema = z.object({
    name: z.string().min(1),
    companyId: z.string().min(1),
    embedding: z.array(z.number()).length(768),
});

// ── Neo4j Community Node ─────────────────────────────────────

export const Neo4jCommunityNodeSchema = z.object({
    id: z.number().int().nonnegative(),
    summary: z.string().min(1),
    companyId: z.string().min(1),
    embedding: z.array(z.number()).length(768),
});

// ── Neo4j Relationship Properties ────────────────────────────

export const Neo4jDynamicRelPropertiesSchema = z.object({
    weight: z.number().min(0).max(1),
    evidenceCount: z.number().int().positive(),
    detail: z.string().nullable(),
    // Array of document IDs that contributed evidence for this relationship.
    // Enables correct scoped deletion in R15 without losing provenance.
    documentIds: z.array(z.number().int().positive()).min(1),
});

// ── Neo4j Write Result ───────────────────────────────────────

export const Neo4jWriteResultSchema = z.object({
    entities: z.number().int().nonnegative(),
    mentions: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    dynamicRelTypes: z.array(z.string()),
    durationMs: z.number().nonnegative(),
});

// ═══════════════════════════════════════════════════════════════
// EMBEDDING PROVIDER SCHEMA
// ═══════════════════════════════════════════════════════════════

export const EmbeddingResultSchema = z.object({
    embedding: z.array(z.number()).min(1),
    dimensions: z.number().int().positive(),
    providerName: z.string().min(1),
});

export const EmbeddingBatchResultSchema = z.object({
    embeddings: z.array(z.array(z.number()).min(1)),
    dimensions: z.number().int().positive(),
    providerName: z.string().min(1),
});

// ═══════════════════════════════════════════════════════════════
// ENSEMBLE SEARCH SCHEMAS
// ═══════════════════════════════════════════════════════════════

export const GraphRetrieverResultSchema = z.object({
    sectionIds: z.array(z.number().int().positive()),
    entityMatchCount: z.number().int().nonnegative(),
    traversalHops: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
});

// ═══════════════════════════════════════════════════════════════
// GRAPH DELETION SCHEMAS (Req 15)
// ═══════════════════════════════════════════════════════════════

export const Neo4jDeleteResultSchema = z.object({
    deletedSections: z.number().int().nonnegative(),
    deletedMentions: z.number().int().nonnegative(),
    deletedRelationships: z.number().int().nonnegative(),
    orphanedEntitiesRemoved: z.number().int().nonnegative(),
    orphanedTopicsRemoved: z.number().int().nonnegative(),
    entitiesUpdated: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
});

// ═══════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════

export type EntityBase = z.infer<typeof EntityBaseSchema>;
export type EntityWithEmbedding = z.infer<typeof EntityWithEmbeddingSchema>;
export type ExtractionEntity = z.infer<typeof ExtractionEntitySchema>;
export type ExtractionRelationship = z.infer<typeof ExtractionRelationshipSchema>;
export type ExtractionChunkResult = z.infer<typeof ExtractionChunkResultSchema>;
export type ExtractRelationshipsResponse = z.infer<typeof ExtractRelationshipsResponseSchema>;
export type Neo4jEntityNode = z.infer<typeof Neo4jEntityNodeSchema>;
export type Neo4jSectionNode = z.infer<typeof Neo4jSectionNodeSchema>;
export type Neo4jDocumentNode = z.infer<typeof Neo4jDocumentNodeSchema>;
export type Neo4jTopicNode = z.infer<typeof Neo4jTopicNodeSchema>;
export type Neo4jCommunityNode = z.infer<typeof Neo4jCommunityNodeSchema>;
export type Neo4jWriteResult = z.infer<typeof Neo4jWriteResultSchema>;
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;
export type EmbeddingBatchResult = z.infer<typeof EmbeddingBatchResultSchema>;
export type GraphRetrieverResult = z.infer<typeof GraphRetrieverResultSchema>;
export type Neo4jDynamicRelProperties = z.infer<typeof Neo4jDynamicRelPropertiesSchema>;
export type Neo4jDeleteResult = z.infer<typeof Neo4jDeleteResultSchema>;
