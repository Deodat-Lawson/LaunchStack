/**
 * Shared Zod Schemas — Neo4j + Gemma GraphRAG
 *
 * These are the runtime-validated contracts that all three workstreams
 * must conform to. Contract compliance tests validate against these.
 *
 * Source of truth: .kiro/specs/neo4j-gemma-graphrag/tests/contracts/gemma-schemas.ts
 * Keep in sync — any changes here must be reflected in the spec.
 */

import { z } from "zod";

// ── BERT Enhanced Entity Schema ──────────────────────────────────────────

export const EntityWithEmbeddingSchema = z.object({
    text: z.string().min(1),
    label: z.string().min(1),
    score: z.number().min(0).max(1),
    embedding: z.array(z.number()).length(768),
});

export const ExtractEntitiesEnhancedResponseSchema = z.object({
    results: z.array(z.object({
        text: z.string(),
        entities: z.array(EntityWithEmbeddingSchema),
    })),
    total_entities: z.number().int().nonnegative(),
});

// ── Gemma Extraction Schemas ─────────────────────────────────────────────

export const GemmaEntitySchema = z.object({
    name: z.string().min(1),
    type: z.enum(["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"]),
});

export const GemmaRelationshipSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/), // SCREAMING_SNAKE_CASE
    detail: z.string(),
});

export const GemmaChunkResultSchema = z.object({
    text: z.string(),
    entities: z.array(GemmaEntitySchema),
    relationships: z.array(GemmaRelationshipSchema),
    dropped_relationships: z.array(GemmaRelationshipSchema),
});

export const GemmaExtractionResponseSchema = z.object({
    results: z.array(GemmaChunkResultSchema),
    total_entities: z.number().int().nonnegative(),
    total_relationships: z.number().int().nonnegative(),
    total_dropped: z.number().int().nonnegative(),
});

// ── Neo4j Sync Result Schema ─────────────────────────────────────────────

export const Neo4jSyncResultSchema = z.object({
    entities: z.number().int().nonnegative(),
    mentions: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    dynamicRelTypes: z.array(z.string()),
    durationMs: z.number().nonnegative(),
});

// ── Type Exports ─────────────────────────────────────────────────────────

export type GemmaEntity = z.infer<typeof GemmaEntitySchema>;
export type GemmaRelationship = z.infer<typeof GemmaRelationshipSchema>;
export type GemmaChunkResult = z.infer<typeof GemmaChunkResultSchema>;
export type GemmaExtractionResponse = z.infer<typeof GemmaExtractionResponseSchema>;
export type Neo4jSyncResult = z.infer<typeof Neo4jSyncResultSchema>;
export type EntityWithEmbedding = z.infer<typeof EntityWithEmbeddingSchema>;
export type ExtractEntitiesEnhancedResponse = z.infer<typeof ExtractEntitiesEnhancedResponseSchema>;
