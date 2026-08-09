/**
 * Engine schema: the tables @launchstack/core owns and publishes.
 *
 * Nothing here may reference a product table in apps/web or
 * @launchstack/features. That one-way rule is what lets a consumer embed the
 * engine and apply `packages/core/drizzle` on its own; ESLint enforces the
 * import direction (eslint.config.js), which is what a foreign key needs.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    varchar,
    bigint,
    vector,
    bigserial,
} from "drizzle-orm/pg-core";

import { uniqueIndex } from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";

// ============================================================================
// Users
// ============================================================================

export const company = pgTable("company", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 64 }),
    description: text("description"),
    industry: varchar("industry", { length: 256 }),
    swatch: integer("swatch").default(1).notNull(),
    // Legacy column; kept in sync with activeEmbeddingIndexKey via
    // updateCompany during the migration window. Drop after callers migrate.
    embeddingIndexKey: varchar("embedding_index_key", { length: 128 }),
    // SearchSettings-style lifecycle. `active` is what ingest/query use;
    // `pending` is the target of an in-progress reindex.
    activeEmbeddingIndexKey: varchar("active_embedding_index_key", { length: 128 }),
    pendingEmbeddingIndexKey: varchar("pending_embedding_index_key", { length: 128 }),
    reindexStatus: varchar("reindex_status", { length: 16 }).notNull().default("STABLE"),
    reindexJobId: text("reindex_job_id"),
    reindexStartedAt: timestamp("reindex_started_at", { withTimezone: true }),
    reindexCompletedAt: timestamp("reindex_completed_at", { withTimezone: true }),
    reindexError: text("reindex_error"),
    // Embedding provider credentials live in `company_embedding_credentials`,
    // encrypted. See src/embeddings/company-credentials.ts.
    employerpasskey: varchar("employerPasskey", { length: 256 }).notNull().default(""),
    employeepasskey: varchar("employeePasskey", { length: 256 }).notNull().default(""),
    numberOfEmployees: varchar("numberOfEmployees", { length: 256 }).notNull(),
    useUploadThing: boolean("use_uploadthing").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});

// ============================================================================
// Invite Codes
// ============================================================================

export const document = pgTable(
    "document",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        url: varchar("url", { length: 256 }).notNull(),
        category: varchar("category", { length: 256 }).notNull(),
        title: varchar("title", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        ocrEnabled: boolean("ocr_enabled").default(false),
        ocrProcessed: boolean("ocr_processed").default(false),
        ocrMetadata: jsonb("ocr_metadata"),
        // New OCR fields
        ocrJobId: varchar("ocr_job_id", { length: 256 }),
        ocrProvider: varchar("ocr_provider", { length: 50 }),
        ocrConfidenceScore: integer("ocr_confidence_score"),
        ocrCostCents: integer("ocr_cost_cents"),
        mimeType: varchar("mime_type", { length: 128 }),
        sourceArchiveName: varchar("source_archive_name", { length: 256 }),
        fileType: varchar("file_type", { length: 128 }),
        currentVersionId: bigint("current_version_id", { mode: "bigint" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),

        // Added after the table shipped, so declared last: ALTER TABLE ADD
        // COLUMN appends physically, and the migrations-apply job compares a
        // migrated database against a freshly-pushed one column by column.
        sourceArchiveEntry: varchar("source_archive_entry", { length: 1024 }),
        creationKey: varchar("creation_key", { length: 512 }),
    },
    table => ({
        companyIdIdx: index("document_company_id_idx").on(table.companyId),
        companyIdIdIdx: index("document_company_id_id_idx").on(table.companyId, table.id),
        companyIdCategoryIdx: index("document_company_id_category_idx").on(
            table.companyId,
            table.category
        ),
        companyCreationKeyUnique: uniqueIndex("document_company_creation_key_unique").on(
            table.companyId,
            table.creationKey
        ),
        currentVersionIdIdx: index("document_current_version_id_idx").on(table.currentVersionId),
    })
);

// ============================================================================
// Document Versions
// ============================================================================

export const documentVersions = pgTable(
    "document_versions",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        versionNumber: integer("version_number").notNull(),
        url: varchar("url", { length: 512 }).notNull(),
        mimeType: varchar("mime_type", { length: 128 }).notNull(),
        fileSize: bigint("file_size", { mode: "bigint" }),
        uploadedBy: varchar("uploaded_by", { length: 256 }),
        changelog: text("changelog"),
        ocrJobId: varchar("ocr_job_id", { length: 256 }),
        ocrProvider: varchar("ocr_provider", { length: 50 }),
        ocrProcessed: boolean("ocr_processed").default(false),
        ocrMetadata: jsonb("ocr_metadata"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),

        // Added after the table shipped — see the note on `document` above.
        creationKey: varchar("creation_key", { length: 512 }),
    },
    table => ({
        documentIdIdx: index("doc_versions_document_id_idx").on(table.documentId),
        documentCreationKeyUnique: uniqueIndex("doc_versions_document_creation_key_unique").on(
            table.documentId,
            table.creationKey
        ),
        documentVersionUnique: uniqueIndex("doc_versions_document_version_unique").on(
            table.documentId,
            table.versionNumber
        ),
    })
);

// ============================================================================
// Category
// ============================================================================

export const category = pgTable(
    "category",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        name: varchar("name", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyIdIdx: index("category_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// PDF Chunks
// ============================================================================
/**
 * @deprecated This table is deprecated in favor of `documentSections` from the RLM schema.
 * Use `documentSections` for all new code. This table is kept for backwards compatibility
 * during migration. It will be removed in a future version.
 *
 * Migration path:
 * - New documents are written to `documentSections` table
 * - Existing data can be migrated using the backfill script at src/scripts/migrate-chunks-to-rlm.ts
 * - Once migration is complete and verified, this table can be dropped
 *
 * @see documentSections in rlm-knowledge-base.ts for the replacement table
 */

export const pdfChunks = pgTable(
    "pdf_chunks",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        page: integer("page").notNull(),
        chunkIndex: integer("chunk_index").notNull().default(0), // deterministic ordering within a page
        content: text("content").notNull(),
        embedding: vector("embedding", { dimensions: 1536 }),
    },
    table => ({
        documentIdIdx: index("pdf_chunks_document_id_idx").on(table.documentId),
        documentIdPageIdx: index("pdf_chunks_document_id_page_idx").on(
            table.documentId,
            table.page
        ),
        documentIdPageChunkIdx: index("pdf_chunks_document_id_page_chunk_idx").on(
            table.documentId,
            table.page,
            table.chunkIndex
        ),
    })
);

// ============================================================================
// Chat History
// ============================================================================

export const fileUploads = pgTable(
    "file_uploads",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        // Active company at upload time. Nullable for legacy rows; new uploads
        // always stamp this so /api/files can enforce tenant ownership directly.
        companyId: bigint("company_id", { mode: "bigint" }).references(
            () => company.id,
            { onDelete: "set null" },
        ),
        filename: varchar("filename", { length: 256 }).notNull(),
        mimeType: varchar("mime_type", { length: 128 }).notNull(),
        fileData: text("file_data"),
        fileSize: integer("file_size").notNull(),
        storageProvider: varchar("storage_provider", { length: 64 }).default("database").notNull(),
        storageUrl: varchar("storage_url", { length: 1024 }),
        storagePathname: varchar("storage_pathname", { length: 1024 }),
        blobChecksum: varchar("blob_checksum", { length: 128 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        userIdIdx: index("file_uploads_user_id_idx").on(table.userId),
        companyIdIdx: index("file_uploads_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// OCR Jobs
// ============================================================================

export const ocrJobs = pgTable(
    "ocr_jobs",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, {
            onDelete: "set null",
        }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),

        // Status
        status: varchar("status", {
            length: 50,
            enum: ["queued", "processing", "completed", "failed", "needs_review"],
        })
            .notNull()
            .default("queued"),

        // Document info
        documentUrl: varchar("document_url", { length: 1024 }).notNull(),
        documentName: varchar("document_name", { length: 256 }).notNull(),
        pageCount: integer("page_count"),
        fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),

        // Pre-assessment
        complexityScore: integer("complexity_score"),
        documentType: varchar("document_type", {
            length: 50,
            enum: ["contract", "financial", "scanned", "general", "other"],
        }),

        // Provider selection
        primaryProvider: varchar("primary_provider", { length: 50 }),
        actualProvider: varchar("actual_provider", { length: 50 }),

        // Cost tracking
        estimatedCostCents: integer("estimated_cost_cents"),
        actualCostCents: integer("actual_cost_cents"),

        // Quality metrics
        confidenceScore: integer("confidence_score"),
        qualityFlags: jsonb("quality_flags").$type<string[]>(),
        requiresReview: boolean("requires_review").default(false),

        // Timing
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        processingDurationMs: integer("processing_duration_ms"),

        // Results
        ocrResult: jsonb("ocr_result"),
        errorMessage: text("error_message"),
        retryCount: integer("retry_count").default(0),

        // Webhook
        webhookUrl: varchar("webhook_url", { length: 1024 }),
        webhookStatus: varchar("webhook_status", {
            length: 20,
            enum: ["pending", "sent", "failed"],
        }),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),

        // Added after the table shipped — see the note on `document` above.
        versionId: bigint("version_id", { mode: "bigint" }).references(() => documentVersions.id, {
            onDelete: "set null",
        }),
        dispatchOptions: jsonb("dispatch_options").$type<Record<string, unknown>>(),
    },
    table => ({
        companyIdIdx: index("ocr_jobs_company_id_idx").on(table.companyId),
        userIdIdx: index("ocr_jobs_user_id_idx").on(table.userId),
        documentIdIdx: index("ocr_jobs_document_id_idx").on(table.documentId),
        versionIdIdx: index("ocr_jobs_version_id_idx").on(table.versionId),
        statusIdx: index("ocr_jobs_status_idx").on(table.status),
        createdAtIdx: index("ocr_jobs_created_at_idx").on(table.createdAt),
        companyStatusIdx: index("ocr_jobs_company_status_idx").on(table.companyId, table.status),
    })
);

// ============================================================================
// OCR Processing Steps
// ============================================================================

export const ocrProcessingSteps = pgTable(
    "ocr_processing_steps",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        jobId: varchar("job_id", { length: 256 })
            .notNull()
            .references(() => ocrJobs.id, { onDelete: "cascade" }),
        stepNumber: integer("step_number").notNull(),
        stepType: varchar("step_type", {
            length: 50,
            enum: [
                "pre_assessment",
                "ocr_execution",
                "validation",
                "embedding",
                "storage",
                "webhook",
            ],
        }).notNull(),
        status: varchar("status", {
            length: 20,
            enum: ["pending", "in_progress", "completed", "failed"],
        })
            .notNull()
            .default("pending"),
        input: jsonb("input"),
        output: jsonb("output"),
        errorMessage: text("error_message"),
        durationMs: integer("duration_ms"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        jobIdIdx: index("ocr_processing_steps_job_id_idx").on(table.jobId),
        jobIdStepIdx: index("ocr_processing_steps_job_id_step_idx").on(
            table.jobId,
            table.stepNumber
        ),
    })
);

// ============================================================================
// OCR Cost Tracking
// ============================================================================

export const ocrCostTracking = pgTable(
    "ocr_cost_tracking",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        provider: varchar("provider", { length: 50 }).notNull(),
        month: varchar("month", { length: 7 }).notNull(), // YYYY-MM format

        totalJobs: integer("total_jobs").default(0).notNull(),
        totalPages: integer("total_pages").default(0).notNull(),
        totalCostCents: integer("total_cost_cents").default(0).notNull(),
        averageCostPerPage: integer("average_cost_per_page").default(0).notNull(),
        averageConfidenceScore: integer("average_confidence_score").default(0).notNull(),

        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyProviderMonthIdx: index("ocr_cost_tracking_company_provider_month_idx").on(
            table.companyId,
            table.provider,
            table.month
        ),
    })
);

// ============================================================================
// Upload Batches
// ============================================================================

export const uploadBatches = pgTable(
    "upload_batches",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        status: varchar("status", {
            length: 32,
            enum: ["created", "uploading", "committed", "processing", "complete", "failed"],
        })
            .notNull()
            .default("created"),
        metadata: jsonb("metadata"),
        totalFiles: integer("total_files").default(0).notNull(),
        uploadedFiles: integer("uploaded_files").default(0).notNull(),
        processedFiles: integer("processed_files").default(0).notNull(),
        failedFiles: integer("failed_files").default(0).notNull(),
        committedAt: timestamp("committed_at", { withTimezone: true }),
        processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        failedAt: timestamp("failed_at", { withTimezone: true }),
        errorMessage: text("error_message"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyIdx: index("upload_batches_company_idx").on(table.companyId),
        creatorIdx: index("upload_batches_creator_idx").on(table.createdByUserId),
        statusIdx: index("upload_batches_status_idx").on(table.status),
    })
);

export const uploadBatchFiles = pgTable(
    "upload_batch_files",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        batchId: varchar("batch_id", { length: 64 })
            .notNull()
            .references(() => uploadBatches.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        filename: varchar("filename", { length: 512 }).notNull(),
        relativePath: varchar("relative_path", { length: 1024 }),
        mimeType: varchar("mime_type", { length: 128 }),
        fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),
        storageUrl: varchar("storage_url", { length: 1024 }),
        storageType: varchar("storage_type", { length: 32 }),
        status: varchar("status", {
            length: 32,
            enum: ["queued", "uploaded", "processing", "complete", "failed"],
        })
            .notNull()
            .default("queued"),
        metadata: jsonb("metadata"),
        documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, {
            onDelete: "set null",
        }),
        jobId: varchar("job_id", { length: 256 }).references(() => ocrJobs.id, {
            onDelete: "set null",
        }),
        errorMessage: text("error_message"),
        uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
        processedAt: timestamp("processed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        batchIdx: index("upload_batch_files_batch_idx").on(table.batchId),
        statusIdx: index("upload_batch_files_status_idx").on(table.status),
        jobIdx: index("upload_batch_files_job_idx").on(table.jobId),
        documentIdx: index("upload_batch_files_document_idx").on(table.documentId),
    })
);

export const uploadBatchesRelations = relations(uploadBatches, ({ many, one }) => ({
    files: many(uploadBatchFiles),
    company: one(company, {
        fields: [uploadBatches.companyId],
        references: [company.id],
    }),
}));

export const uploadBatchFilesRelations = relations(uploadBatchFiles, ({ one }) => ({
    batch: one(uploadBatches, {
        fields: [uploadBatchFiles.batchId],
        references: [uploadBatches.id],
    }),
    document: one(document, {
        fields: [uploadBatchFiles.documentId],
        references: [document.id],
    }),
    job: one(ocrJobs, {
        fields: [uploadBatchFiles.jobId],
        references: [ocrJobs.id],
    }),
}));

// ============================================================================
// Document Views (for tracking document click/view events)
// ============================================================================

export const companyRelations = relations(company, ({ many }) => ({
    documents: many(document),
    categories: many(category),
}));

export const documentsRelations = relations(document, ({ one, many }) => ({
    company: one(company, {
        fields: [document.companyId],
        references: [company.id],
    }),
    pdfChunks: many(pdfChunks),
    versions: many(documentVersions),
    currentVersion: one(documentVersions, {
        fields: [document.currentVersionId],
        references: [documentVersions.id],
        relationName: "document_current_version",
    }),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
    document: one(document, {
        fields: [documentVersions.documentId],
        references: [document.id],
    }),
}));

export const categoryRelations = relations(category, ({ one }) => ({
    company: one(company, {
        fields: [category.companyId],
        references: [company.id],
    }),
}));

export const pdfChunksRelations = relations(pdfChunks, ({ one }) => ({
    document: one(document, {
        fields: [pdfChunks.documentId],
        references: [document.id],
    }),
}));

export const ocrJobsRelations = relations(ocrJobs, ({ one, many }) => ({
    company: one(company, {
        fields: [ocrJobs.companyId],
        references: [company.id],
    }),
    document: one(document, {
        fields: [ocrJobs.documentId],
        references: [document.id],
    }),
    processingSteps: many(ocrProcessingSteps),
}));

export const ocrProcessingStepsRelations = relations(ocrProcessingSteps, ({ one }) => ({
    job: one(ocrJobs, {
        fields: [ocrProcessingSteps.jobId],
        references: [ocrJobs.id],
    }),
}));

export const ocrCostTrackingRelations = relations(ocrCostTracking, ({ one }) => ({
    company: one(company, {
        fields: [ocrCostTracking.companyId],
        references: [company.id],
    }),
}));

export type Company = InferSelectModel<typeof company>;

export type Document = InferSelectModel<typeof document>;

export type DocumentVersion = InferSelectModel<typeof documentVersions>;

export type Category = InferSelectModel<typeof category>;

export type PdfChunk = InferSelectModel<typeof pdfChunks>;

export type FileUpload = InferSelectModel<typeof fileUploads>;

export type OcrJob = InferSelectModel<typeof ocrJobs>;

export type OcrProcessingStep = InferSelectModel<typeof ocrProcessingSteps>;

export type OcrCostTracking = InferSelectModel<typeof ocrCostTracking>;
