/**
 * Product schema: features layered on an engine document.
 *
 * Q&A history, predictive-analysis output, reference resolutions, view
 * tracking and generated documents are product surface — no core code touches
 * them. May reference engine tables; never the reverse.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company, document, documentVersions } from "@launchstack/store/schema";

export const ChatHistory = pgTable(
    "chat_history",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
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
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
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
        id: bigserial("id", { mode: "number" }).primaryKey(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        analysisType: varchar("analysis_type", { length: 256 }).notNull(),
        includeRelatedDocs: boolean("include_related_docs").default(false),
        resultJson: jsonb("result_json").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),

        // Added after the table shipped, so declared last: ALTER TABLE ADD
        // COLUMN appends physically, and the migrations-apply job compares a
        // migrated database against a freshly-pushed one column by column.
        versionId: bigint("version_id", { mode: "bigint" }).references(() => documentVersions.id, {
            onDelete: "cascade",
        }),
    },
    table => ({
        documentIdIdx: index("predictive_analysis_document_id_idx").on(table.documentId),
        documentVersionIdx: index("predictive_analysis_document_version_idx").on(
            table.documentId,
            table.versionId
        ),
    })
);

// ============================================================================
// Document Reference Resolution
// ============================================================================

export const documentReferenceResolution = pgTable(
    "document_reference_resolutions",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        referenceName: varchar("reference_name", { length: 256 }).notNull(),
        resolvedInDocumentId: bigint("resolved_in_document_id", { mode: "number" }),
        resolutionDetails: jsonb("resolution_details"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    table => ({
        companyRefIdx: index("document_reference_resolutions_company_ref_idx").on(table.companyId),
    })
);

// ============================================================================
// File Uploads (for local storage when UploadThing is disabled)
// ============================================================================

export const documentViews = pgTable(
    "document_views",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
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
    table => ({
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

export const chatHistoryRelations = relations(ChatHistory, ({ one }) => ({
    document: one(document, {
        fields: [ChatHistory.documentId],
        references: [document.id],
    }),
}));

export const predictiveAnalysisRelations = relations(
    predictiveDocumentAnalysisResults,
    ({ one }) => ({
        document: one(document, {
            fields: [predictiveDocumentAnalysisResults.documentId],
            references: [document.id],
        }),
    })
);

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
        id: bigserial("id", { mode: "number" }).primaryKey(),
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
        citations: jsonb("citations").$type<
            Array<{
                id: string;
                text: string;
                sourceUrl?: string;
                sourceTitle?: string;
                format: string;
                createdAt: string;
            }>
        >(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
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

export type ChatHistoryEntry = InferSelectModel<typeof ChatHistory>;

export type PredictiveDocumentAnalysisResult = InferSelectModel<
    typeof predictiveDocumentAnalysisResults
>;

export type DocumentReferenceResolution = InferSelectModel<typeof documentReferenceResolution>;

export type DocumentView = InferSelectModel<typeof documentViews>;

export type GeneratedDocument = InferSelectModel<typeof generatedDocuments>;
