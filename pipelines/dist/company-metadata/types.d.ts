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
export declare const VISIBILITY_VALUES: readonly ["public", "partner", "private", "internal"];
export declare const USAGE_VALUES: readonly ["outreach_ok", "outreach_ok_with_approval", "no_outreach"];
export declare const PRIORITY_VALUES: readonly ["manual_override", "high", "normal", "low"];
export declare const FACT_STATUS_VALUES: readonly ["active", "deprecated", "superseded"];
export declare const CHANGE_TYPE_VALUES: readonly ["extraction", "merge", "manual_override", "deprecation"];
export type ChangeType = (typeof CHANGE_TYPE_VALUES)[number];
/**
 * Where a fact was extracted from.
 *
 * `version_id` is what makes a fact *citable*: a citation anchor is only valid
 * with a positive source version id, so a fact carrying only `doc_id` can be
 * attributed to a document but never to the exact revision that said it.
 * Optional because facts extracted before this field existed cannot be
 * back-filled — they degrade to document-level provenance rather than
 * fabricating a version.
 */
export interface MetadataSource {
    doc_id: number;
    doc_name: string;
    extracted_at: string;
    /** The document version the fact was read from. Absent on legacy facts. */
    version_id?: number;
    snippet_ref?: string;
    page?: number;
    /** Verbatim supporting text, when the extractor captured one. */
    quote?: string;
}
/**
 * A single metadata fact with provenance, access-control, and lifecycle info.
 * Generic over the value type — defaults to `string`.
 */
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
/**
 * Output of the extractor: facts extracted from a single document,
 * before they are merged into the canonical metadata.
 */
export interface ExtractedCompanyFacts {
    document_id: number;
    document_name: string;
    extracted_at: string;
    facts: Partial<Omit<CompanyMetadataJSON, "schema_version" | "company_id" | "updated_at" | "provenance" | "derived_views">>;
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
/** Build an empty metadata document for a newly-tracked company. */
export declare function createEmptyMetadata(companyId: string): CompanyMetadataJSON;
//# sourceMappingURL=types.d.ts.map