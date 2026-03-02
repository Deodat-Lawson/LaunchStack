/**
 * Company Metadata Schema
 *
 * Stores a canonical per-company metadata JSON derived from uploaded documents.
 * Used downstream by LLMs generating outreach messages / posts.
 *
 * - `companyMetadata` — one row per company, holds the current canonical JSON.
 * - `companyMetadataHistory` — append-only audit log of every mutation.
 */

import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    index,
    jsonb,
    serial,
    timestamp,
    varchar,
    bigint,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";
import { company, document } from "./base";
import type {
    CompanyMetadataJSON,
    MetadataDiff,
    ChangeType,
} from "~/lib/tools/company-metadata/types";
import { CHANGE_TYPE_VALUES } from "~/lib/tools/company-metadata/types";

// ============================================================================
// Company Metadata (canonical current state — one row per company)
// ============================================================================

export const companyMetadata = pgTable(
    "company_metadata",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        schemaVersion: varchar("schema_version", { length: 20 })
            .notNull()
            .default("1.0.0"),
        metadata: jsonb("metadata")
            .notNull()
            .$type<CompanyMetadataJSON>(),
        lastExtractionDocumentId: bigint("last_extraction_document_id", {
            mode: "bigint",
        }).references(() => document.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date(),
        ),
    },
    (table) => ({
        companyIdUnique: uniqueIndex("company_metadata_company_id_unique").on(
            table.companyId,
        ),
    }),
);

// ============================================================================
// Company Metadata History (append-only audit log)
// ============================================================================

export const companyMetadataHistory = pgTable(
    "company_metadata_history",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" }).references(
            () => document.id,
            { onDelete: "set null" },
        ),
        changeType: varchar("change_type", {
            length: 32,
            enum: CHANGE_TYPE_VALUES,
        }).notNull(),
        diff: jsonb("diff").notNull().$type<MetadataDiff>(),
        changedBy: varchar("changed_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        companyIdIdx: index("company_metadata_history_company_id_idx").on(
            table.companyId,
        ),
        documentIdIdx: index("company_metadata_history_document_id_idx").on(
            table.documentId,
        ),
        createdAtIdx: index("company_metadata_history_created_at_idx").on(
            table.createdAt,
        ),
        changeTypeIdx: index("company_metadata_history_change_type_idx").on(
            table.changeType,
        ),
    }),
);

// ============================================================================
// Relations
// ============================================================================

export const companyMetadataRelations = relations(companyMetadata, ({ one }) => ({
    company: one(company, {
        fields: [companyMetadata.companyId],
        references: [company.id],
    }),
    lastExtractionDocument: one(document, {
        fields: [companyMetadata.lastExtractionDocumentId],
        references: [document.id],
    }),
}));

export const companyMetadataHistoryRelations = relations(
    companyMetadataHistory,
    ({ one }) => ({
        company: one(company, {
            fields: [companyMetadataHistory.companyId],
            references: [company.id],
        }),
        document: one(document, {
            fields: [companyMetadataHistory.documentId],
            references: [document.id],
        }),
    }),
);

// ============================================================================
// Type Exports
// ============================================================================

export type CompanyMetadataRow = InferSelectModel<typeof companyMetadata>;
export type CompanyMetadataHistoryRow = InferSelectModel<typeof companyMetadataHistory>;

// Re-export the JSON types so consumers can import from one place
export type { CompanyMetadataJSON, MetadataDiff, ChangeType };
