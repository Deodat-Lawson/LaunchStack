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

// ============================================================================
// Canonical JSON shapes for the company_metadata + company_metadata_history
// JSONB columns. Source of truth. The feature module re-exports these along
// with its richer surface (Zod schemas, helper builders) so existing callers
// can keep importing from ~/lib/tools/company-metadata/types.
// ============================================================================

export const CHANGE_TYPE_VALUES = [
    "extraction",
    "merge",
    "manual_override",
    "deprecation",
] as const;
export type ChangeType = (typeof CHANGE_TYPE_VALUES)[number];

export type Visibility = "public" | "partner" | "private" | "internal";
export type Usage = "outreach_ok" | "outreach_ok_with_approval" | "no_outreach";
export type Priority = "manual_override" | "high" | "normal" | "low";
export type FactStatus = "active" | "deprecated" | "superseded";

export interface MetadataSource {
    doc_id: number;
    doc_name: string;
    extracted_at: string;
    snippet_ref?: string;
    page?: number;
}

export interface MetadataFact<T = string> {
    value: T;
    visibility: Visibility;
    usage: Usage;
    confidence: number;
    priority: Priority;
    status: FactStatus;
    last_updated: string;
    valid_from?: string;
    valid_to?: string;
    sources: MetadataSource[];
}

export interface CompanyInfo {
    name?: MetadataFact;
    industry?: MetadataFact;
    founded_year?: MetadataFact<number>;
    headquarters?: MetadataFact;
    description?: MetadataFact;
    website?: MetadataFact;
    size?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}

export interface PersonEntry {
    name: MetadataFact;
    role?: MetadataFact;
    email?: MetadataFact;
    phone?: MetadataFact;
    department?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}

export interface ServiceEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}

export interface MarketsInfo {
    primary?: MetadataFact[];
    verticals?: MetadataFact[];
    geographies?: MetadataFact[];
}

export interface SubprojectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
}

export interface ProjectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
    subprojects?: SubprojectEntry[];
    [key: string]: MetadataFact<unknown> | SubprojectEntry[] | undefined;
}

export interface LegalEntry {
    name: MetadataFact;
    type?: MetadataFact;
    summary?: MetadataFact;
    effective_date?: MetadataFact;
    expiry_date?: MetadataFact;
    parties?: MetadataFact;
    status?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}

export interface ProvenanceInfo {
    total_documents_processed: number;
    last_document_processed?: {
        doc_id: number;
        doc_name: string;
        processed_at: string;
    };
    extraction_model: string;
    extraction_version: string;
}

export interface CompanyMetadataJSON {
    schema_version: string;
    company_id: string;
    updated_at: string;

    company: CompanyInfo;
    people: PersonEntry[];
    services: ServiceEntry[];
    markets: MarketsInfo;
    projects: ProjectEntry[];
    policies: Record<string, MetadataFact>;
    legal: LegalEntry[];

    provenance: ProvenanceInfo;
    derived_views?: Record<string, string>;
}

export interface DiffEntry {
    path: string;
    old?: MetadataFact<unknown>;
    new?: MetadataFact<unknown>;
}

export interface MetadataDiff {
    added: DiffEntry[];
    updated: DiffEntry[];
    deprecated: DiffEntry[];
}

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
