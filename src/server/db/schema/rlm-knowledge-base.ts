import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    varchar,
    bigint,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { pgVector } from "../pgVector";
import { pgTable } from "./helpers";
import { document, company, documentVersions } from "./base";

// ============================================================================
// Enums as string unions (Drizzle style)
// ============================================================================

export const contentTypeEnum = [
    "section",
    "table",
    "figure",
    "list",
    "paragraph",
    "appendix",
    "header",
    "footer",
] as const;

export const semanticTypeEnum = [
    "narrative",
    "procedural",
    "tabular",
    "legal",
    "financial",
    "technical",
    "reference",
] as const;

export const documentClassEnum = [
    "contract",
    "policy",
    "compliance",
    "hr",
    "financial",
    "technical",
    "manual",
    "report",
    "other",
] as const;

export const previewTypeEnum = [
    "summary",
    "outline",
    "keywords",
    "key_points",
    "abstract",
    "first_paragraph",
] as const;

export const resultTypeEnum = [
    "extraction",
    "summary",
    "analysis",
    "reasoning_step",
    "checkpoint",
    "verification",
    "sub_query",
] as const;

export const workspaceStatusEnum = [
    "pending",
    "processing",
    "completed",
    "failed",
    "expired",
] as const;

// ============================================================================
// 1. Document Structure - Hierarchical Document Tree
// ============================================================================
// Represents document structure (sections, subsections, tables, figures)
// with parent-child relationships for recursive decomposition.

export const documentStructure = pgTable(
    "document_structure",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        // Versioning: which version of the document this structure node belongs to.
        // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
        // Deleting a version cascades and removes its structure nodes.
        versionId: bigint("version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        parentId: bigint("parent_id", { mode: "bigint" }), // Self-reference, null for root
        level: integer("level").notNull().default(0), // Depth: 0=root, 1=section, 2+=subsection
        ordering: integer("ordering").notNull().default(0), // Sibling order for traversal
        title: text("title"), // Section heading (nullable for content-only nodes)
        contentType: varchar("content_type", {
            length: 50,
            enum: contentTypeEnum,
        })
            .notNull()
            .default("section"),
        path: varchar("path", { length: 256 }), // Tree path (e.g., "1.2.3")
        startPage: integer("start_page"),
        endPage: integer("end_page"),
        childCount: integer("child_count").notNull().default(0),
        // Token count for this node only (excluding children)
        tokenCount: integer("token_count").default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        documentIdIdx: index("doc_structure_document_id_idx").on(table.documentId),
        parentIdIdx: index("doc_structure_parent_id_idx").on(table.parentId),
        documentLevelIdx: index("doc_structure_document_level_idx").on(
            table.documentId,
            table.level
        ),
        documentPathIdx: index("doc_structure_document_path_idx").on(
            table.documentId,
            table.path
        ),
        documentOrderingIdx: index("doc_structure_document_ordering_idx").on(
            table.documentId,
            table.parentId,
            table.ordering
        ),
        versionIdIdx: index("doc_structure_version_id_idx").on(table.versionId),
    })
);


export const documentContextChunks = pgTable(
    "document_context_chunks",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        // Versioning: which version of the document this chunk belongs to.
        // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
        versionId: bigint("version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        structureId: bigint("structure_id", { mode: "bigint" }).references(
            () => documentStructure.id,
            { onDelete: "cascade" }
        ),
        content: text("content").notNull(),
        tokenCount: integer("token_count").notNull().default(0), // For cost estimation
        charCount: integer("char_count").notNull().default(0),
        // Optional embedding for the parent chunk (can be used for coarse retrieval)
        embedding: pgVector({ dimension: 1536 })("embedding"),
        contentHash: varchar("content_hash", { length: 64 }), // SHA-256 for deduplication
        semanticType: varchar("semantic_type", {
            length: 50,
            enum: semanticTypeEnum,
        }),
        pageNumber: integer("page_number"),
        // Additional metadata for fine-grained access
        lineStart: integer("line_start"),
        lineEnd: integer("line_end"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        documentIdIdx: index("doc_ctx_chunks_document_id_idx").on(table.documentId),
        structureIdIdx: index("doc_ctx_chunks_structure_id_idx").on(table.structureId),
        documentPageIdx: index("doc_ctx_chunks_document_page_idx").on(
            table.documentId,
            table.pageNumber
        ),
        contentHashIdx: index("doc_ctx_chunks_content_hash_idx").on(table.contentHash),
        semanticTypeIdx: index("doc_ctx_chunks_semantic_type_idx").on(
            table.documentId,
            table.semanticType
        ),
        versionIdIdx: index("doc_ctx_chunks_version_id_idx").on(table.versionId),
    })
);

export const documentRetrievalChunks = pgTable(
    "document_retrieval_chunks",
    {
        id: serial("id").primaryKey(),
        contextChunkId: bigint("context_chunk_id", { mode: "bigint" })
            .notNull()
            .references(() => documentContextChunks.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        // Versioning: which version of the document this retrieval chunk belongs to.
        // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
        versionId: bigint("version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        content: text("content").notNull(),
        tokenCount: integer("token_count").notNull().default(0),

        // Full dimension embedding (storage)
        embedding: pgVector({ dimension: 1536 })("embedding"),
        
        // Matryoshka optimization: Index only the first 512 dimensions for speed
        embeddingShort: pgVector({ dimension: 512 })("embedding_short"),
        
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        contextChunkIdIdx: index("doc_ret_chunks_context_chunk_id_idx").on(table.contextChunkId),
        documentIdIdx: index("doc_ret_chunks_document_id_idx").on(table.documentId),
        // Index on the short embedding for fast ANN search
        embeddingShortIdx: index("doc_ret_chunks_embedding_short_idx").using(
            "hnsw",
            table.embeddingShort.op("vector_cosine_ops")
        ),
        versionIdIdx: index("doc_ret_chunks_version_id_idx").on(table.versionId),
    })
);

export const documentMetadata = pgTable(
    "document_metadata",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        // Versioning: which version of the document this metadata belongs to.
        // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
        versionId: bigint("version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        // Token/size metrics for cost-aware planning
        totalTokens: integer("total_tokens").default(0),
        totalSections: integer("total_sections").default(0),
        totalTables: integer("total_tables").default(0),
        totalFigures: integer("total_figures").default(0),
        totalPages: integer("total_pages").default(0),
        maxSectionDepth: integer("max_section_depth").default(0),
        // Semantic metadata
        topicTags: jsonb("topic_tags").$type<string[]>(),
        summary: text("summary"), // AI-generated summary
        outline: jsonb("outline").$type<OutlineNode[]>(), // Document TOC structure
        // Classification
        complexityScore: integer("complexity_score"), // 0-100 complexity rating
        documentClass: varchar("document_class", {
            length: 50,
            enum: documentClassEnum,
        }),
        // Extracted entities for quick filtering
        entities: jsonb("entities").$type<ExtractedEntities>(),
        // Document-level embedding for similarity
        summaryEmbedding: pgVector({ dimension: 1536 })("summary_embedding"),
        // Date range covered in document (for temporal queries)
        dateRangeStart: timestamp("date_range_start", { withTimezone: true }),
        dateRangeEnd: timestamp("date_range_end", { withTimezone: true }),
        // Language and formatting
        language: varchar("language", { length: 10 }).default("en"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        documentIdUnique: uniqueIndex("doc_metadata_document_id_unique").on(
            table.documentId
        ),
        complexityIdx: index("doc_metadata_complexity_idx").on(table.complexityScore),
        documentClassIdx: index("doc_metadata_class_idx").on(table.documentClass),
        totalTokensIdx: index("doc_metadata_total_tokens_idx").on(table.totalTokens),
        versionIdIdx: index("doc_metadata_version_id_idx").on(table.versionId),
    })
);

// ============================================================================
// 4. Document Previews - Cheap Inspection Layer
// ============================================================================
// Pre-computed previews for probing before full retrieval.

export const documentPreviews = pgTable(
    "document_previews",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        // Versioning: which version of the document this preview belongs to.
        // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
        versionId: bigint("version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        sectionId: bigint("section_id", { mode: "bigint" }).references(
            () => documentContextChunks.id,
            { onDelete: "cascade" }
        ),
        structureId: bigint("structure_id", { mode: "bigint" }).references(
            () => documentStructure.id,
            { onDelete: "cascade" }
        ),
        previewType: varchar("preview_type", {
            length: 50,
            enum: previewTypeEnum,
        }).notNull(),
        content: text("content").notNull(),
        tokenCount: integer("token_count").notNull().default(0),
        embedding: pgVector({ dimension: 1536 })("embedding"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        documentIdIdx: index("doc_previews_document_id_idx").on(table.documentId),
        sectionIdIdx: index("doc_previews_section_id_idx").on(table.sectionId),
        documentTypeIdx: index("doc_previews_document_type_idx").on(
            table.documentId,
            table.previewType
        ),
        versionIdIdx: index("doc_previews_version_id_idx").on(table.versionId),
    })
);

// ============================================================================
// 5. Workspace Results - RLM Recursion Support
// ============================================================================
// Intermediate results storage for recursive operations.
// "The KB is a workspace, not just a database."

export const workspaceResults = pgTable(
    "workspace_results",
    {
        id: serial("id").primaryKey(),
        sessionId: varchar("session_id", { length: 256 }).notNull(), // Groups related work
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" }).references(
            () => document.id,
            { onDelete: "cascade" }
        ),
        sectionId: bigint("section_id", { mode: "bigint" }).references(
            () => documentContextChunks.id,
            { onDelete: "cascade" }
        ),
        structureId: bigint("structure_id", { mode: "bigint" }).references(
            () => documentStructure.id,
            { onDelete: "cascade" }
        ),
        // Result classification
        resultType: varchar("result_type", {
            length: 50,
            enum: resultTypeEnum,
        }).notNull(),
        // The actual intermediate result
        content: text("content").notNull(),
        // Rich metadata for tracking execution context
        metadata: jsonb("metadata").$type<WorkspaceMetadata>(),
        // Status tracking
        status: varchar("status", {
            length: 20,
            enum: workspaceStatusEnum,
        })
            .notNull()
            .default("pending"),
        // For chaining/dependencies
        parentResultId: bigint("parent_result_id", { mode: "bigint" }),
        // TTL for cleanup
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        sessionIdIdx: index("workspace_session_id_idx").on(table.sessionId),
        userIdIdx: index("workspace_user_id_idx").on(table.userId),
        companyIdIdx: index("workspace_company_id_idx").on(table.companyId),
        documentIdIdx: index("workspace_document_id_idx").on(table.documentId),
        sessionTypeIdx: index("workspace_session_type_idx").on(
            table.sessionId,
            table.resultType
        ),
        statusIdx: index("workspace_status_idx").on(table.status),
        expiresAtIdx: index("workspace_expires_at_idx").on(table.expiresAt),
        parentResultIdx: index("workspace_parent_result_idx").on(table.parentResultId),
    })
);

// ============================================================================
// Relations
// ============================================================================

export const documentStructureRelations = relations(
    documentStructure,
    ({ one, many }) => ({
        document: one(document, {
            fields: [documentStructure.documentId],
            references: [document.id],
        }),
        parent: one(documentStructure, {
            fields: [documentStructure.parentId],
            references: [documentStructure.id],
            relationName: "structure_parent_child",
        }),
        children: many(documentStructure, {
            relationName: "structure_parent_child",
        }),
        sections: many(documentContextChunks),
        previews: many(documentPreviews),
    })
);

export const documentContextChunksRelations = relations(
    documentContextChunks,
    ({ one, many }) => ({
        document: one(document, {
            fields: [documentContextChunks.documentId],
            references: [document.id],
        }),
        structure: one(documentStructure, {
            fields: [documentContextChunks.structureId],
            references: [documentStructure.id],
        }),
        retrievalChunks: many(documentRetrievalChunks),
        previews: many(documentPreviews),
        workspaceResults: many(workspaceResults),
    })
);

export const documentRetrievalChunksRelations = relations(
    documentRetrievalChunks,
    ({ one }) => ({
        contextChunk: one(documentContextChunks, {
            fields: [documentRetrievalChunks.contextChunkId],
            references: [documentContextChunks.id],
        }),
        document: one(document, {
            fields: [documentRetrievalChunks.documentId],
            references: [document.id],
        }),
    })
);

export const documentMetadataRelations = relations(documentMetadata, ({ one }) => ({
    document: one(document, {
        fields: [documentMetadata.documentId],
        references: [document.id],
    }),
}));

export const documentPreviewsRelations = relations(documentPreviews, ({ one }) => ({
    document: one(document, {
        fields: [documentPreviews.documentId],
        references: [document.id],
    }),
    section: one(documentContextChunks, {
        fields: [documentPreviews.sectionId],
        references: [documentContextChunks.id],
    }),
    structure: one(documentStructure, {
        fields: [documentPreviews.structureId],
        references: [documentStructure.id],
    }),
}));

export const workspaceResultsRelations = relations(workspaceResults, ({ one }) => ({
    company: one(company, {
        fields: [workspaceResults.companyId],
        references: [company.id],
    }),
    document: one(document, {
        fields: [workspaceResults.documentId],
        references: [document.id],
    }),
    section: one(documentContextChunks, {
        fields: [workspaceResults.sectionId],
        references: [documentContextChunks.id],
    }),
    structure: one(documentStructure, {
        fields: [workspaceResults.structureId],
        references: [documentStructure.id],
    }),
    parentResult: one(workspaceResults, {
        fields: [workspaceResults.parentResultId],
        references: [workspaceResults.id],
        relationName: "workspace_parent_child",
    }),
}));

// ============================================================================
// Type Definitions for JSONB columns
// ============================================================================

export interface OutlineNode {
    id: number;
    title: string;
    level: number;
    path: string;
    children?: OutlineNode[];
    tokenCount?: number;
    pageRange?: { start: number; end: number };
}

export interface ExtractedEntities {
    people?: string[];
    organizations?: string[];
    dates?: string[];
    amounts?: { value: number; currency: string; context: string }[];
    locations?: string[];
    custom?: Record<string, string[]>;
}

export interface WorkspaceMetadata {
    sourceRefs?: Array<{
        documentId: number;
        sectionId?: number;
        structureId?: number;
        path?: string;
    }>;
    executionContext?: {
        model?: string;
        promptTokens?: number;
        completionTokens?: number;
        latencyMs?: number;
    };
    qualityMetrics?: {
        confidence?: number;
        verified?: boolean;
        verificationMethod?: string;
    };
    parentChain?: number[]; // IDs of all parent results in the recursion chain
    tags?: string[];
}

// ============================================================================
// Type Exports
// ============================================================================

export type DocumentStructure = InferSelectModel<typeof documentStructure>;
export type DocumentSection = InferSelectModel<typeof documentContextChunks>;
export type DocumentRetrievalChunk = InferSelectModel<typeof documentRetrievalChunks>;
export type DocumentMetadataRecord = InferSelectModel<typeof documentMetadata>;
export type DocumentPreview = InferSelectModel<typeof documentPreviews>;
export type WorkspaceResult = InferSelectModel<typeof workspaceResults>;

// Content type unions
export type ContentType = (typeof contentTypeEnum)[number];
export type SemanticType = (typeof semanticTypeEnum)[number];
export type DocumentClass = (typeof documentClassEnum)[number];
export type PreviewType = (typeof previewTypeEnum)[number];
export type ResultType = (typeof resultTypeEnum)[number];
export type WorkspaceStatus = (typeof workspaceStatusEnum)[number];

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

export const documentSections = documentContextChunks;
export const documentSectionsRelations = documentContextChunksRelations;
