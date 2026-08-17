import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    varchar,
    bigint,
} from "drizzle-orm/pg-core";

import { uniqueIndex, check } from "drizzle-orm/pg-core";
// Needed to type a self-referential foreign key (storage_deletion_items'
// linked_to_item_id points back at storage_deletion_items.id) — without the
// explicit return type TypeScript hits a circular inference error.
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { pgVector } from "../pgVector";
import { pgTable } from "./helpers";

// ============================================================================
// Users
// ============================================================================

export const users = pgTable(
    "users",
    {
        id: serial("id").primaryKey(),
        name: varchar("name", { length: 256 }).notNull(),
        email: varchar("email", { length: 256 }).notNull(),
        userId: varchar("userId", { length: 256 }).notNull().unique(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 256 }).notNull(),
        status: varchar("status", { length: 256 }).notNull(),
        lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdIdx: index("users_company_id_idx").on(table.companyId),
        userIdIdx: index("users_user_id_idx").on(table.userId),
    })
);

// ============================================================================
// Company
// ============================================================================

export const company = pgTable("company", {
    id: serial("id").primaryKey(),
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
    // Legacy plaintext credential columns. Read-only during migration;
    // writes go through src/lib/ai/company-credentials.ts into the
    // encrypted `company_embedding_credentials` table. Dropped by
    // drizzle/0011 once backfill has run.
    embeddingOpenAIApiKey: text("embedding_openai_api_key"),
    embeddingHuggingFaceApiKey: text("embedding_huggingface_api_key"),
    embeddingOllamaBaseUrl: varchar("embedding_ollama_base_url", { length: 1024 }),
    embeddingOllamaModel: varchar("embedding_ollama_model", { length: 256 }),
    employerpasskey: varchar("employerPasskey", { length: 256 }).notNull().default(""),
    employeepasskey: varchar("employeePasskey", { length: 256 }).notNull().default(""),
    numberOfEmployees: varchar("numberOfEmployees", { length: 256 }).notNull(),
    useUploadThing: boolean("use_uploadthing").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
        () => new Date()
    ),
});

// ============================================================================
// Invite Codes
// ============================================================================

export const inviteCodes = pgTable(
    "invite_codes",
    {
        id: serial("id").primaryKey(),
        code: varchar("code", { length: 12 }).notNull().unique(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 256 }).notNull(), // "employer" or "employee"
        isActive: boolean("is_active").default(true).notNull(),
        createdBy: varchar("created_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        codeIdx: index("invite_codes_code_idx").on(table.code),
        companyIdIdx: index("invite_codes_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// User <-> Company Memberships
// ============================================================================
// Lets a user belong to multiple workspaces. `users.companyId` remains the
// user's *default* workspace; the active workspace per request is selected
// from this table via the active-workspace cookie.

export const userCompanyMemberships = pgTable(
    "user_company_memberships",
    {
        id: serial("id").primaryKey(),
        userId: bigint("user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 16 }).notNull(), // 'owner' | 'admin' | 'editor'
        lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        uniqUserCompany: uniqueIndex("user_company_memberships_user_company_unique").on(
            table.userId,
            table.companyId
        ),
        userIdIdx: index("user_company_memberships_user_id_idx").on(table.userId),
        companyIdIdx: index("user_company_memberships_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Document
// ============================================================================

export const document = pgTable(
    "document",
    {
        id: serial("id").primaryKey(),
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
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdIdx: index("document_company_id_idx").on(table.companyId),
        companyIdIdIdx: index("document_company_id_id_idx").on(table.companyId, table.id),
        companyIdCategoryIdx: index("document_company_id_category_idx").on(
            table.companyId,
            table.category
        ),
        currentVersionIdIdx: index("document_current_version_id_idx").on(
            table.currentVersionId
        ),
    })
);

// ============================================================================
// Document Versions
// ============================================================================

export const documentVersions = pgTable(
    "document_versions",
    {
        id: serial("id").primaryKey(),
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
    },
    (table) => ({
        documentIdIdx: index("doc_versions_document_id_idx").on(table.documentId),
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
        id: serial("id").primaryKey(),
        name: varchar("name", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
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
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        page: integer("page").notNull(),
        chunkIndex: integer("chunk_index").notNull().default(0), // deterministic ordering within a page
        content: text("content").notNull(),
        embedding: pgVector({ dimension: 1536 })("embedding"),
    },
    (table) => ({
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

export const ChatHistory = pgTable(
    "chat_history",
    {
        id: serial("id").primaryKey(),
        UserId: varchar("user_id", { length: 256 }).notNull(), // Clerk user ID
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        documentTitle: varchar("document_title", { length: 256 }).notNull(),
        question: text("question").notNull(),
        response: text("response").notNull(),
        chatId: varchar("chat_id", { length: 256 }),
        queryType: varchar("query_type", {
            length: 20,
            enum: ["simple", "advanced"],
        }).default("simple"),
        pages: integer("pages").array().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        userIdIdx: index("chat_history_user_id_idx").on(table.UserId),
        userIdCreatedAtIdx: index("chat_history_user_id_created_at_idx").on(
            table.UserId,
            table.createdAt
        ),
        documentIdIdx: index("chat_history_document_id_idx").on(table.documentId),
    })
);

// ============================================================================
// Predictive Document Analysis Results
// ============================================================================

export const predictiveDocumentAnalysisResults = pgTable(
    "predictive_document_analysis_results",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        analysisType: varchar("analysis_type", { length: 256 }).notNull(),
        includeRelatedDocs: boolean("include_related_docs").default(false),
        resultJson: jsonb("result_json").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        documentIdIdx: index("predictive_analysis_document_id_idx").on(table.documentId),
    })
);

// ============================================================================
// Document Reference Resolution
// ============================================================================

export const documentReferenceResolution = pgTable(
    "document_reference_resolutions",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        referenceName: varchar("reference_name", { length: 256 }).notNull(),
        resolvedInDocumentId: integer("resolved_in_document_id"),
        resolutionDetails: jsonb("resolution_details"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => ({
        companyRefIdx: index("document_reference_resolutions_company_ref_idx").on(
            table.companyId
        ),
    })
);

// ============================================================================
// File Uploads (for local storage when UploadThing is disabled)
// ============================================================================

export const fileUploads = pgTable(
    "file_uploads",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
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
    (table) => ({
        userIdIdx: index("file_uploads_user_id_idx").on(table.userId),
    })
);

// ============================================================================
// OCR Jobs
// ============================================================================

export const ocrJobs = pgTable(
    "ocr_jobs",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, { onDelete: "set null" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),

        // Status
        status: varchar("status", {
            length: 50,
            enum: ["queued", "processing", "completed", "failed", "needs_review"]
        }).notNull().default("queued"),

        // Document info
        documentUrl: varchar("document_url", { length: 1024 }).notNull(),
        documentName: varchar("document_name", { length: 256 }).notNull(),
        pageCount: integer("page_count"),
        fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),

        // Pre-assessment
        complexityScore: integer("complexity_score"),
        documentType: varchar("document_type", {
            length: 50,
            enum: ["contract", "financial", "scanned", "general", "other"]
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
            enum: ["pending", "sent", "failed"]
        }),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdIdx: index("ocr_jobs_company_id_idx").on(table.companyId),
        userIdIdx: index("ocr_jobs_user_id_idx").on(table.userId),
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
            enum: ["pre_assessment", "ocr_execution", "validation", "embedding", "storage", "webhook"]
        }).notNull(),
        status: varchar("status", {
            length: 20,
            enum: ["pending", "in_progress", "completed", "failed"]
        }).notNull().default("pending"),
        input: jsonb("input"),
        output: jsonb("output"),
        errorMessage: text("error_message"),
        durationMs: integer("duration_ms"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        jobIdIdx: index("ocr_processing_steps_job_id_idx").on(table.jobId),
        jobIdStepIdx: index("ocr_processing_steps_job_id_step_idx").on(table.jobId, table.stepNumber),
    })
);

// ============================================================================
// OCR Cost Tracking
// ============================================================================

export const ocrCostTracking = pgTable(
    "ocr_cost_tracking",
    {
        id: serial("id").primaryKey(),
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

        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
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
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdx: index("upload_batches_company_idx").on(table.companyId),
        creatorIdx: index("upload_batches_creator_idx").on(table.createdByUserId),
        statusIdx: index("upload_batches_status_idx").on(table.status),
    })
);

export const uploadBatchFiles = pgTable(
    "upload_batch_files",
    {
        id: serial("id").primaryKey(),
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
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
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

export const documentViews = pgTable(
    "document_views",
    {
        id: serial("id").primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        viewedAt: timestamp("viewed_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        documentIdIdx: index("document_views_document_id_idx").on(table.documentId),
        companyIdIdx: index("document_views_company_id_idx").on(table.companyId),
        userIdIdx: index("document_views_user_id_idx").on(table.userId),
        companyIdViewedAtIdx: index("document_views_company_id_viewed_at_idx").on(
            table.companyId,
            table.viewedAt
        ),
    })
);

// ============================================================================
// Relations
// ============================================================================

export const companyRelations = relations(company, ({ many }) => ({
    users: many(users),
    documents: many(document),
    categories: many(category),
    inviteCodes: many(inviteCodes),
    memberships: many(userCompanyMemberships),
}));

export const userCompanyMembershipsRelations = relations(
    userCompanyMemberships,
    ({ one }) => ({
        user: one(users, {
            fields: [userCompanyMemberships.userId],
            references: [users.id],
        }),
        company: one(company, {
            fields: [userCompanyMemberships.companyId],
            references: [company.id],
        }),
    })
);

export const inviteCodesRelations = relations(inviteCodes, ({ one }) => ({
    company: one(company, {
        fields: [inviteCodes.companyId],
        references: [company.id],
    }),
}));

export const usersRelations = relations(users, ({ one }) => ({
    company: one(company, {
        fields: [users.companyId],
        references: [company.id],
    }),
}));

export const documentsRelations = relations(document, ({ one, many }) => ({
    company: one(company, {
        fields: [document.companyId],
        references: [company.id],
    }),
    pdfChunks: many(pdfChunks),
    chatHistory: many(ChatHistory),
    predictiveAnalysisResults: many(predictiveDocumentAnalysisResults),
    views: many(documentViews),
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

export const chatHistoryRelations = relations(ChatHistory, ({ one }) => ({
    document: one(document, {
        fields: [ChatHistory.documentId],
        references: [document.id],
    }),
}));

export const predictiveAnalysisRelations = relations(predictiveDocumentAnalysisResults, ({ one }) => ({
    document: one(document, {
        fields: [predictiveDocumentAnalysisResults.documentId],
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

export const documentViewsRelations = relations(documentViews, ({ one }) => ({
    document: one(document, {
        fields: [documentViews.documentId],
        references: [document.id],
    }),
    company: one(company, {
        fields: [documentViews.companyId],
        references: [company.id],
    }),
}));

// ============================================================================
// Generated Documents (Document Generator feature)
// ============================================================================

export const generatedDocuments = pgTable(
    "generated_documents",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        title: varchar("title", { length: 512 }).notNull(),
        content: text("content").notNull(),
        templateId: varchar("template_id", { length: 64 }),
        metadata: jsonb("metadata").$type<{
            tone?: string;
            audience?: string;
            length?: string;
            description?: string;
            templateType?: "general" | "legal";
            legalData?: Record<string, string>;
            /** Full section list from LegalDocumentEditor (labels + structure) */
            legalSections?: Array<{
                id: string;
                type: "title" | "heading" | "paragraph";
                label?: string;
                content: string;
                editable?: boolean;
            }>;
        }>(),
        citations: jsonb("citations").$type<Array<{
            id: string;
            text: string;
            sourceUrl?: string;
            sourceTitle?: string;
            format: string;
            createdAt: string;
        }>>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        userIdIdx: index("generated_documents_user_id_idx").on(table.userId),
        companyIdIdx: index("generated_documents_company_id_idx").on(table.companyId),
        companyUserIdx: index("generated_documents_company_user_idx").on(
            table.companyId,
            table.userId
        ),
    })
);

export const generatedDocumentsRelations = relations(generatedDocuments, ({ one }) => ({
    company: one(company, {
        fields: [generatedDocuments.companyId],
        references: [company.id],
    }),
}));

// ============================================================================
// Storage Objects (manifest — one row per real object in storage)
// ============================================================================
// Tracks provider-owned object identity independent of URLs, so a document's
// deletion can enumerate and clean up every file it owns. See
// docs/storage-deletion-runbook.md for the full lifecycle design.

export const storageObjects = pgTable(
    "storage_objects",
    {
        id: serial("id").primaryKey(),

        // Immutable ObjectRef — opaque outside the adapter that minted it.
        adapter: varchar("adapter", {
            length: 32,
            enum: ["s3", "vercel-blob", "database", "uploadthing"],
        }).notNull(),
        storageLocationId: varchar("storage_location_id", { length: 256 }).notNull(),
        key: text("key").notNull(),

        // Tenant + owner. Exactly one of documentId / documentVersionId /
        // artifactId must be set — enforced by a CHECK constraint below.
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" }).references(
            () => document.id,
            { onDelete: "cascade" }
        ),
        documentVersionId: bigint("document_version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        artifactId: bigint("artifact_id", { mode: "bigint" }),

        // Metadata — best-effort, not all providers supply all fields.
        contentType: varchar("content_type", { length: 128 }),
        sizeBytes: bigint("size_bytes", { mode: "bigint" }),
        checksum: varchar("checksum", { length: 256 }),
        sourceOperation: varchar("source_operation", { length: 64 }),

        // Lifecycle
        lifecycleState: varchar("lifecycle_state", {
            length: 32,
            enum: [
                "ACTIVE",
                "DELETE_REQUESTED",
                "STORAGE_DELETING",
                "STORAGE_CLEAN",
                "RELATIONAL_PURGE",
                "PURGED",
                "WAITING_RETRY",
                "BLOCKED",
                "QUARANTINED",
                "CANCELLED",
            ],
        })
            .notNull()
            .default("ACTIVE"),
        deletionAttempts: integer("deletion_attempts").default(0).notNull(),
        lastError: text("last_error"),

        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        // Never two manifest rows claiming the same physical object.
        adapterLocationKeyUnique: uniqueIndex(
            "storage_objects_adapter_location_key_unique"
        ).on(table.adapter, table.storageLocationId, table.key),
        companyIdIdx: index("storage_objects_company_id_idx").on(table.companyId),
        documentIdIdx: index("storage_objects_document_id_idx").on(table.documentId),
        documentVersionIdIdx: index("storage_objects_document_version_id_idx").on(
            table.documentVersionId
        ),
        lifecycleStateIdx: index("storage_objects_lifecycle_state_idx").on(
            table.lifecycleState
        ),
        // Exactly one owner column populated per row.
        exactlyOneOwnerCheck: check(
            "storage_objects_exactly_one_owner_check",
            sql`(
                (CASE WHEN ${table.documentId} IS NOT NULL THEN 1 ELSE 0 END) +
                (CASE WHEN ${table.documentVersionId} IS NOT NULL THEN 1 ELSE 0 END) +
                (CASE WHEN ${table.artifactId} IS NOT NULL THEN 1 ELSE 0 END)
            ) = 1`
        ),
    })
);

export const storageObjectsRelations = relations(storageObjects, ({ one }) => ({
    company: one(company, {
        fields: [storageObjects.companyId],
        references: [company.id],
    }),
    document: one(document, {
        fields: [storageObjects.documentId],
        references: [document.id],
    }),
    documentVersion: one(documentVersions, {
        fields: [storageObjects.documentVersionId],
        references: [documentVersions.id],
    }),
}));

// ============================================================================
// Storage Artifact Edges (parent/child relationships between storage objects)
// ============================================================================
// Records derivation relationships — e.g. a ZIP object and its extracted
// children, or a document and a generated summary/transcript — so the
// deletion coordinator can cascade a delete across a whole artifact group.
// One parent per child (unique constraint below); confirmed with the team
// that no current or planned flow needs a child to trace back to more than
// one parent. `edgeType` is intentionally a free varchar, not a locked enum:
// the full taxonomy of edge types is owned by the artifact-lineage policy
// work (C2), not finalized yet.

export const storageArtifactEdges = pgTable(
    "storage_artifact_edges",
    {
        id: serial("id").primaryKey(),
        parentObjectId: bigint("parent_object_id", { mode: "bigint" })
            .notNull()
            .references(() => storageObjects.id, { onDelete: "cascade" }),
        childObjectId: bigint("child_object_id", { mode: "bigint" })
            .notNull()
            .references(() => storageObjects.id, { onDelete: "cascade" }),
        edgeType: varchar("edge_type", { length: 64 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        // One parent per child.
        parentChildUnique: uniqueIndex(
            "storage_artifact_edges_parent_child_unique"
        ).on(table.parentObjectId, table.childObjectId),
        parentObjectIdIdx: index("storage_artifact_edges_parent_object_id_idx").on(
            table.parentObjectId
        ),
        childObjectIdIdx: index("storage_artifact_edges_child_object_id_idx").on(
            table.childObjectId
        ),
    })
);

export const storageArtifactEdgesRelations = relations(
    storageArtifactEdges,
    ({ one }) => ({
        parent: one(storageObjects, {
            fields: [storageArtifactEdges.parentObjectId],
            references: [storageObjects.id],
            relationName: "artifact_edge_parent",
        }),
        child: one(storageObjects, {
            fields: [storageArtifactEdges.childObjectId],
            references: [storageObjects.id],
            relationName: "artifact_edge_child",
        }),
    })
);

// ============================================================================
// Storage Deletion Requests + Items (durable deletion intent)
// ============================================================================
// A deletion request is the outer record ("delete document #42"); each item
// is one physical object that must be deleted to fulfill it. Recorded
// *before* any storage or relational deletion happens, so a crash mid-delete
// never loses track of what still needs cleaning up. `status` on the request
// is a maintained summary (updated by the worker as items change), not
// recomputed on read — chosen for fast status-polling reads, at the cost of
// the worker needing to keep it in sync correctly.

export const storageDeletionRequests = pgTable(
    "storage_deletion_requests",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        // Exactly one of these two must be set — enforced by the CHECK below.
        documentId: bigint("document_id", { mode: "bigint" }).references(
            () => document.id,
            { onDelete: "cascade" }
        ),
        documentVersionId: bigint("document_version_id", { mode: "bigint" }).references(
            () => documentVersions.id,
            { onDelete: "cascade" }
        ),
        requestedBy: varchar("requested_by", { length: 256 }).notNull(),
        // Maintained summary status — see Decision 6 in the design doc.
        status: varchar("status", {
            length: 32,
            enum: ["queued", "completed", "partial", "manual_review", "quarantined"],
        })
            .notNull()
            .default("queued"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    (table) => ({
        companyIdIdx: index("storage_deletion_requests_company_id_idx").on(
            table.companyId
        ),
        documentIdIdx: index("storage_deletion_requests_document_id_idx").on(
            table.documentId
        ),
        documentVersionIdIdx: index(
            "storage_deletion_requests_document_version_id_idx"
        ).on(table.documentVersionId),
        statusIdx: index("storage_deletion_requests_status_idx").on(table.status),
        exactlyOneTargetCheck: check(
            "storage_deletion_requests_exactly_one_target_check",
            sql`(
                (CASE WHEN ${table.documentId} IS NOT NULL THEN 1 ELSE 0 END) +
                (CASE WHEN ${table.documentVersionId} IS NOT NULL THEN 1 ELSE 0 END)
            ) = 1`
        ),
    })
);

export const storageDeletionItems = pgTable(
    "storage_deletion_items",
    {
        id: serial("id").primaryKey(),
        requestId: bigint("request_id", { mode: "bigint" })
            .notNull()
            .references(() => storageDeletionRequests.id, { onDelete: "cascade" }),
        // Nullable: legacy-promoted refs (no manifest row yet) carry the ref
        // fields directly instead of pointing at a storage_objects row. Set
        // null (not cascaded) if the linked manifest row is later purged, so
        // this item's history survives as an audit record.
        objectId: bigint("object_id", { mode: "bigint" }).references(
            () => storageObjects.id,
            { onDelete: "set null" }
        ),
        adapter: varchar("adapter", {
            length: 32,
            enum: ["s3", "vercel-blob", "database", "uploadthing"],
        }).notNull(),
        storageLocationId: varchar("storage_location_id", { length: 256 }).notNull(),
        key: text("key").notNull(),
        // Cross-document dedup (B5): when two documents in one batch delete
        // reference the same physical file, exactly one item ("the leader")
        // performs the real provider call and every other item ("a follower")
        // points at it here and inherits its outcome. Only ever set on
        // legacy-promoted items — manifest-backed objects are exclusively
        // owned by one target, so they can't collide across documents.
        // ON DELETE SET NULL so a follower survives the leader's document
        // being purged; the worker copies the leader's final state onto its
        // followers before that cascade, so a null pointer never means a
        // lost outcome.
        linkedToItemId: bigint("linked_to_item_id", { mode: "bigint" }).references(
            (): AnyPgColumn => storageDeletionItems.id,
            { onDelete: "set null" }
        ),
        itemState: varchar("item_state", {
            length: 32,
            enum: [
                "PENDING",
                "IN_FLIGHT",
                "WAITING_RETRY",
                "DELETED",
                "NOT_FOUND",
                "RETRYABLE_FAILED",
                "BLOCKED",
                "QUARANTINED",
                // Not independently processed: this item's real outcome lives
                // on the item named by linkedToItemId. The worker's
                // itemsToProcess filter is a PENDING/WAITING_RETRY allowlist,
                // so LINKED is skipped without any filter change.
                "LINKED",
            ],
        })
            .notNull()
            .default("PENDING"),
        attempts: integer("attempts").default(0).notNull(),
        lastError: text("last_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        requestIdIdx: index("storage_deletion_items_request_id_idx").on(
            table.requestId
        ),
        objectIdIdx: index("storage_deletion_items_object_id_idx").on(table.objectId),
        itemStateIdx: index("storage_deletion_items_item_state_idx").on(
            table.itemState
        ),
        // Supports the purge-time materialization lookup: "does anything
        // point at the leader items I'm about to cascade away?"
        linkedToItemIdIdx: index("storage_deletion_items_linked_to_item_id_idx").on(
            table.linkedToItemId
        ),
    })
);

export const storageDeletionRequestsRelations = relations(
    storageDeletionRequests,
    ({ one, many }) => ({
        company: one(company, {
            fields: [storageDeletionRequests.companyId],
            references: [company.id],
        }),
        document: one(document, {
            fields: [storageDeletionRequests.documentId],
            references: [document.id],
        }),
        documentVersion: one(documentVersions, {
            fields: [storageDeletionRequests.documentVersionId],
            references: [documentVersions.id],
        }),
        items: many(storageDeletionItems),
    })
);

export const storageDeletionItemsRelations = relations(
    storageDeletionItems,
    ({ one }) => ({
        request: one(storageDeletionRequests, {
            fields: [storageDeletionItems.requestId],
            references: [storageDeletionRequests.id],
        }),
        object: one(storageObjects, {
            fields: [storageDeletionItems.objectId],
            references: [storageObjects.id],
        }),
    })
);

// ============================================================================
// Storage Deletion Tombstones (permanent, post-purge audit + idempotency)
// ============================================================================
// A tombstone is the one thing that survives after a document/version is
// hard-deleted in RELATIONAL_PURGE — it's what lets a duplicate/repeat
// delete request on an already-purged document return the existing outcome
// instead of erroring or redoing work. Kept intentionally minimal: detailed
// per-object outcomes already live in storage_deletion_items; duplicating
// that here would create two audit trails with no clear source of truth.
//
// documentId / documentVersionId are plain, unconstrained bigints — NOT
// real foreign keys. A real FK would either block the document from ever
// being purged, or cascade-delete the tombstone along with it, defeating
// the whole point of a tombstone surviving the purge it's recording.

export const storageDeletionTombstones = pgTable(
    "storage_deletion_tombstones",
    {
        id: serial("id").primaryKey(),
        requestId: bigint("request_id", { mode: "bigint" }).references(
            () => storageDeletionRequests.id,
            { onDelete: "set null" }
        ),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        // Intentionally not a real FK — see comment above.
        documentId: bigint("document_id", { mode: "bigint" }),
        documentVersionId: bigint("document_version_id", { mode: "bigint" }),
        // Only the two real terminal outcomes a tombstone can represent.
        finalStatus: varchar("final_status", {
            length: 32,
            enum: ["completed", "quarantined"],
        }).notNull(),
        objectCount: integer("object_count").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        // One tombstone per document / per version — supports the
        // idempotency lookup ("has this already been handled").
        documentIdUnique: uniqueIndex(
            "storage_deletion_tombstones_document_id_unique"
        ).on(table.documentId),
        documentVersionIdUnique: uniqueIndex(
            "storage_deletion_tombstones_document_version_id_unique"
        ).on(table.documentVersionId),
        requestIdIdx: index("storage_deletion_tombstones_request_id_idx").on(
            table.requestId
        ),
        companyIdIdx: index("storage_deletion_tombstones_company_id_idx").on(
            table.companyId
        ),
    })
);

export const storageDeletionTombstonesRelations = relations(
    storageDeletionTombstones,
    ({ one }) => ({
        request: one(storageDeletionRequests, {
            fields: [storageDeletionTombstones.requestId],
            references: [storageDeletionRequests.id],
        }),
        company: one(company, {
            fields: [storageDeletionTombstones.companyId],
            references: [company.id],
        }),
    })
);

// ============================================================================
// Type exports
// ============================================================================

export type User = InferSelectModel<typeof users>;
export type Company = InferSelectModel<typeof company>;
export type Document = InferSelectModel<typeof document>;
export type DocumentVersion = InferSelectModel<typeof documentVersions>;
export type Category = InferSelectModel<typeof category>;
export type PdfChunk = InferSelectModel<typeof pdfChunks>;
export type ChatHistoryEntry = InferSelectModel<typeof ChatHistory>;
export type PredictiveDocumentAnalysisResult = InferSelectModel<typeof predictiveDocumentAnalysisResults>;
export type DocumentReferenceResolution = InferSelectModel<typeof documentReferenceResolution>;
export type FileUpload = InferSelectModel<typeof fileUploads>;
export type OcrJob = InferSelectModel<typeof ocrJobs>;
export type OcrProcessingStep = InferSelectModel<typeof ocrProcessingSteps>;
export type OcrCostTracking = InferSelectModel<typeof ocrCostTracking>;
export type DocumentView = InferSelectModel<typeof documentViews>;
export type GeneratedDocument = InferSelectModel<typeof generatedDocuments>;
export type InviteCode = InferSelectModel<typeof inviteCodes>;
export type UserCompanyMembership = InferSelectModel<typeof userCompanyMemberships>;
export type StorageObject = InferSelectModel<typeof storageObjects>;
export type StorageArtifactEdge = InferSelectModel<typeof storageArtifactEdges>;
export type StorageDeletionRequest = InferSelectModel<typeof storageDeletionRequests>;
export type StorageDeletionItem = InferSelectModel<typeof storageDeletionItems>;
export type StorageDeletionTombstone = InferSelectModel<typeof storageDeletionTombstones>;