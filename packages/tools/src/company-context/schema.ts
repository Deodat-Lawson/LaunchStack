/**
 * Company Metadata Schema — the shared company-knowledge data contract.
 *
 * Stores a canonical per-company metadata JSON derived from uploaded documents.
 * Written by the company-metadata extraction vertical; read by the
 * company-context tool (and through it, the marketing and email pipelines).
 * Lives in the tools layer so producers and consumers both import the contract
 * from the shared package — the same relationship engine tables have with
 * adapters. `@launchstack/features/schema` re-exports it, so the product
 * migration set (apps/web/drizzle) is unchanged.
 *
 * - `companyMetadata` — one row per company, holds the current canonical JSON.
 * - `companyMetadataHistory` — append-only audit log of every mutation.
 */

import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    index,
    integer,
    jsonb,
    text,
    timestamp,
    varchar,
    bigint,
    uniqueIndex,
    bigserial,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company, document } from "@launchstack/store/schema";

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
    /**
     * The document version the fact was read from. Required for a fact to
     * produce a valid citation anchor; absent on facts extracted before the
     * field existed, which stay document-level rather than inventing one.
     */
    version_id?: number;
    snippet_ref?: string;
    page?: number;
    /** Verbatim supporting text, when the extractor captured one. */
    quote?: string;
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

/** A fact with the label a person reads: "Mission", "Annual budget". */
export interface LabeledFact<T = string> extends MetadataFact<T> {
    label: string;
}

export const APPLICANT_TYPE_VALUES = [
    "nonprofit",
    "small_business",
    "for_profit",
    "individual",
] as const;
export type ApplicantType = (typeof APPLICANT_TYPE_VALUES)[number];

/**
 * What a reader of the whole profile needs beyond the catalog sections: a
 * summary, the kind of organisation, the fields it works in, and the
 * reusable facts a proposal writer keeps at hand (mission, outcomes,
 * budget…). Schema 1.1.0; absent on profiles built before it.
 */
export interface ProfileInfo {
    summary?: MetadataFact;
    applicant_type?: MetadataFact<ApplicantType>;
    focus_areas?: MetadataFact[];
    /** Keyed by a stable slug: mission, programs, outcomes, annual_budget, … */
    facts?: Record<string, LabeledFact>;
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
    /** Sources read for the profile on the last build (schema 1.1.0). */
    sources_counted?: number;
    /** Hash of the assembled facts the summary was written from; unchanged facts skip the summary call. */
    facts_hash?: string;
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
    /** Schema 1.1.0. */
    profile?: ProfileInfo;

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

export const BUILD_STATUS_VALUES = ["idle", "building", "failed"] as const;
export type BuildStatus = (typeof BUILD_STATUS_VALUES)[number];

export const companyMetadata = pgTable(
    "company_metadata",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        schemaVersion: varchar("schema_version", { length: 20 }).notNull().default("1.0.0"),
        metadata: jsonb("metadata").notNull().$type<CompanyMetadataJSON>(),
        lastExtractionDocumentId: bigint("last_extraction_document_id", {
            mode: "bigint",
        }).references(() => document.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        // Declared after the timestamps because the migration adds them to an existing
        // table: a fresh `push` and the migrated schema must have the same column order.
        /**
         * A build in flight — a Rebuild, or a per-upload refresh while nothing else is
         * building — or the last one failed.
         */
        buildStatus: varchar("build_status", { length: 16, enum: BUILD_STATUS_VALUES })
            .notNull()
            .default("idle"),
        buildError: text("build_error"),
        buildStartedAt: timestamp("build_started_at", { withTimezone: true }),
        /** When the profile was last assembled from its sources. */
        builtAt: timestamp("built_at", { withTimezone: true }),
    },
    table => ({
        companyIdUnique: uniqueIndex("company_metadata_company_id_unique").on(table.companyId),
    })
);

// ============================================================================
// Company Metadata History (append-only audit log)
// ============================================================================

export const companyMetadataHistory = pgTable(
    "company_metadata_history",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, {
            onDelete: "set null",
        }),
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
    table => ({
        companyIdIdx: index("company_metadata_history_company_id_idx").on(table.companyId),
        documentIdIdx: index("company_metadata_history_document_id_idx").on(table.documentId),
        createdAtIdx: index("company_metadata_history_created_at_idx").on(table.createdAt),
        changeTypeIdx: index("company_metadata_history_change_type_idx").on(table.changeType),
    })
);

// ============================================================================
// Company profile sources (one row per document: what reading it decided)
// ============================================================================

export const SOURCE_ROLE_VALUES = ["about_us", "third_party", "no_content"] as const;
/** Written by or about the company, someone else's material, or nothing to read. */
export type SourceRole = (typeof SOURCE_ROLE_VALUES)[number];

export const SOURCE_OVERRIDE_VALUES = ["about_us", "set_aside"] as const;
export type SourceOverride = (typeof SOURCE_OVERRIDE_VALUES)[number];

export const SOURCE_STATUS_VALUES = ["pending", "done", "failed"] as const;
export type SourceStatus = (typeof SOURCE_STATUS_VALUES)[number];

/** Passages in, passages kept, and why the rest were dropped. */
export interface SourcePassageCounts {
    total: number;
    kept: number;
    dropped: Record<string, number>;
}

/**
 * The facts one source version supplies, before they are assembled into the
 * profile. Same sections as {@link CompanyMetadataJSON}; every fact carries
 * its own quote and page in `sources`.
 */
export type SourceFacts = Partial<
    Pick<
        CompanyMetadataJSON,
        | "company"
        | "people"
        | "services"
        | "markets"
        | "projects"
        | "policies"
        | "legal"
        | "profile"
    >
>;

/**
 * What reading one document decided, for the version it was read at. The
 * profile is assembled from these rows on every build, so a deleted document
 * (cascade), a new version (re-read), or a person's override (`override`)
 * changes the profile without any fact being patched by hand.
 */
export const companyProfileSources = pgTable(
    "company_profile_sources",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        /** The document version this row was read at; a different current version means re-read. */
        versionId: bigint("version_id", { mode: "bigint" }),
        role: varchar("role", { length: 16, enum: SOURCE_ROLE_VALUES }),
        roleBy: varchar("role_by", { length: 8, enum: ["rules", "model"] }),
        /** One sentence for the person: who wrote it and why it does or doesn't count. */
        reason: text("reason"),
        /** A person's decision; survives new versions. */
        override: varchar("override", { length: 16, enum: SOURCE_OVERRIDE_VALUES }),
        overrideBy: varchar("override_by", { length: 256 }),
        status: varchar("status", { length: 16, enum: SOURCE_STATUS_VALUES })
            .notNull()
            .default("pending"),
        error: text("error"),
        /** Null when the source was not read for facts (set aside, or nothing to read). */
        facts: jsonb("facts").$type<SourceFacts>(),
        factCount: integer("fact_count").notNull().default(0),
        passages: jsonb("passages").$type<SourcePassageCounts>(),
        /** Prompt + rules version the row was produced under; a bump re-reads every source. */
        readerVersion: varchar("reader_version", { length: 32 }),
        modelId: varchar("model_id", { length: 128 }),
        readAt: timestamp("read_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        documentUnique: uniqueIndex("company_profile_sources_document_unique").on(
            table.companyId,
            table.documentId
        ),
        documentIdIdx: index("company_profile_sources_document_id_idx").on(table.documentId),
    })
);
export type CompanyProfileSourceRow = InferSelectModel<typeof companyProfileSources>;

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

export const companyMetadataHistoryRelations = relations(companyMetadataHistory, ({ one }) => ({
    company: one(company, {
        fields: [companyMetadataHistory.companyId],
        references: [company.id],
    }),
    document: one(document, {
        fields: [companyMetadataHistory.documentId],
        references: [document.id],
    }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type CompanyMetadataRow = InferSelectModel<typeof companyMetadata>;
export type CompanyMetadataHistoryRow = InferSelectModel<typeof companyMetadataHistory>;
