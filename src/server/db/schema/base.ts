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
        fileData: text("file_data").notNull(), // Base64 encoded file data
        fileSize: integer("file_size").notNull(),
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
}));

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
// Type exports
// ============================================================================

export type User = InferSelectModel<typeof users>;
export type Company = InferSelectModel<typeof company>;
export type Document = InferSelectModel<typeof document>;
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
