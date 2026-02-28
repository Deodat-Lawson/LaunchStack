/**
 * Company Metadata Types
 *
 * Defines the canonical JSON structure stored in the `company_metadata` JSONB
 * column.  Every individual fact is wrapped in a {@link MetadataFact} that
 * carries visibility, confidence, priority, provenance and deprecation info.
 *
 * The top-level {@link CompanyMetadataJSON} is the full document that
 * downstream consumers (outreach LLMs, dashboards, APIs) read.
 */

// ============================================================================
// Enums
// ============================================================================

/** Who is allowed to see this fact. */
export type Visibility = "public" | "partner" | "private" | "internal";

/** Whether this fact may be used in automated outreach content. */
export type Usage = "outreach_ok" | "outreach_ok_with_approval" | "no_outreach";

/**
 * Override / freshness ranking.
 * `manual_override` is never overwritten by automated extraction.
 */
export type Priority = "manual_override" | "high" | "normal" | "low";

/** Lifecycle status of a fact. */
export type FactStatus = "active" | "deprecated" | "superseded";

export const VISIBILITY_VALUES = [
    "public",
    "partner",
    "private",
    "internal",
] as const;

export const USAGE_VALUES = [
    "outreach_ok",
    "outreach_ok_with_approval",
    "no_outreach",
] as const;

export const PRIORITY_VALUES = [
    "manual_override",
    "high",
    "normal",
    "low",
] as const;

export const FACT_STATUS_VALUES = [
    "active",
    "deprecated",
    "superseded",
] as const;

export const CHANGE_TYPE_VALUES = [
    "extraction",
    "merge",
    "manual_override",
    "deprecation",
] as const;

export type ChangeType = (typeof CHANGE_TYPE_VALUES)[number];

// ============================================================================
// Fact wrapper (reused on every field)
// ============================================================================

/** Where a fact was extracted from. */
export interface MetadataSource {
    doc_id: number;
    doc_name: string;
    extracted_at: string; // ISO 8601
    snippet_ref?: string;
    page?: number;
}

/**
 * A single metadata fact with provenance, access-control, and lifecycle info.
 * Generic over the value type — defaults to `string`.
 */
export interface MetadataFact<T = string> {
    value: T;
    visibility: Visibility;
    usage: Usage;
    confidence: number; // 0.0 – 1.0
    priority: Priority;
    status: FactStatus;
    last_updated: string; // ISO 8601
    valid_from?: string; // ISO 8601
    valid_to?: string; // ISO 8601 — set when deprecated/superseded
    sources: MetadataSource[];
}

// ============================================================================
// Top-level canonical JSON
// ============================================================================

export interface CompanyMetadataJSON {
    schema_version: string;
    company_id: string;
    updated_at: string; // ISO 8601

    company: CompanyInfo;
    people: PersonEntry[];
    services: ServiceEntry[];
    markets: MarketsInfo;
    projects: ProjectEntry[];
    policies: Record<string, MetadataFact>;

    provenance: ProvenanceInfo;
    derived_views?: Record<string, string>;
}

// ---- Sub-structures ----

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

export interface ProjectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
    subprojects?: SubprojectEntry[];
    [key: string]: MetadataFact<unknown> | SubprojectEntry[] | undefined;
}

export interface SubprojectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
}

export interface ProvenanceInfo {
    total_documents_processed: number;
    last_document_processed?: {
        doc_id: number;
        doc_name: string;
        processed_at: string; // ISO 8601
    };
    extraction_model: string;
    extraction_version: string;
}

// ============================================================================
// Extractor ↔ Merger contract
// ============================================================================

/**
 * Output of the extractor: facts extracted from a single document,
 * before they are merged into the canonical metadata.
 */
export interface ExtractedCompanyFacts {
    document_id: number;
    document_name: string;
    extracted_at: string; // ISO 8601
    facts: Partial<
        Omit<
            CompanyMetadataJSON,
            | "schema_version"
            | "company_id"
            | "updated_at"
            | "provenance"
            | "derived_views"
        >
    >;
}

/**
 * Output of the merger: the updated canonical metadata plus a
 * machine-readable diff for the audit history table.
 */
export interface MergeResult {
    updatedMetadata: CompanyMetadataJSON;
    diff: MetadataDiff;
}

export interface MetadataDiff {
    added: DiffEntry[];
    updated: DiffEntry[];
    deprecated: DiffEntry[];
}

export interface DiffEntry {
    /** JSON-pointer-style path, e.g. "company.name" or "people[0].role" */
    path: string;
    old?: MetadataFact<unknown>;
    new?: MetadataFact<unknown>;
}

// ============================================================================
// Helpers
// ============================================================================

/** Build an empty metadata document for a newly-tracked company. */
export function createEmptyMetadata(companyId: string): CompanyMetadataJSON {
    return {
        schema_version: "1.0.0",
        company_id: companyId,
        updated_at: new Date().toISOString(),
        company: {},
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: {},
        provenance: {
            total_documents_processed: 0,
            extraction_model: "",
            extraction_version: "1.0.0",
        },
    };
}
