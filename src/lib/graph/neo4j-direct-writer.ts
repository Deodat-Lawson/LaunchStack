/**
 * Neo4jDirectWriter — contract-only interface for writing graph data directly to Neo4j.
 * This file contains ONLY interfaces and types — no implementation, no imports of
 * neo4j-driver or database modules, no dependency on neo4j-sync.ts.
 *
 * Dev C implements this interface in a later sub-spec.
 */

/** Replaces the old neo4j-sync.ts "read from Postgres" pattern */
export interface Neo4jDirectWriter {
    /** Write entities directly to Neo4j (idempotent MERGE) */
    writeEntities(entities: Neo4jEntityInput[], companyId: string): Promise<number>;
    /** Write relationships with dynamic Cypher types (idempotent MERGE) */
    writeRelationships(relationships: Neo4jRelationshipInput[], companyId: string): Promise<string[]>;
    /** Write section nodes and MENTIONED_IN edges */
    writeMentions(mentions: Neo4jMentionInput[], companyId: string): Promise<number>;
    /** Write document content graph nodes (Document, Topic, cross-doc links) */
    writeDocumentGraph(doc: Neo4jDocumentGraphInput, companyId: string): Promise<void>;
    /** Ensure vector indexes exist (idempotent) */
    ensureIndexes(): Promise<void>;
}

export interface Neo4jEntityInput {
    /** Normalized lowercase name */
    name: string;
    /** Original casing */
    displayName: string;
    /** Entity label: PER, ORG, LOC, PRODUCT, EVENT, MISC, OTHER */
    label: string;
    confidence: number;
    mentionCount: number;
    companyId: string;
    /** 768-dim BERT CLS vector (nullable) */
    embedding?: number[];
}

export interface Neo4jRelationshipInput {
    sourceName: string;
    sourceLabel: string;
    targetName: string;
    targetLabel: string;
    /** SCREAMING_SNAKE_CASE dynamic relationship type */
    relationType: string;
    weight: number;
    evidenceCount: number;
    detail?: string;
    documentId: number;
    companyId: string;
}

export interface Neo4jMentionInput {
    entityName: string;
    entityLabel: string;
    sectionId: number;
    documentId: number;
    confidence: number;
    companyId: string;
}

export interface Neo4jDocumentGraphInput {
    document: {
        id: number;
        name: string;
        companyId: string;
        /** ISO timestamp */
        uploadedAt: string;
    };
    /** Section IDs for CONTAINS edges */
    sectionIds: number[];
    topics?: {
        name: string;
        companyId: string;
        /** 768-dim embedding */
        embedding: number[];
        /** Sections that DISCUSS this topic */
        sectionIds: number[];
    }[];
}

export interface Neo4jWriteResult {
    entities: number;
    mentions: number;
    relationships: number;
    dynamicRelTypes: string[];
    durationMs: number;
}
