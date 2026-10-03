/**
 * Company Metadata Types
 *
 * The canonical JSON stored in the `company_metadata` JSONB column is defined
 * once, in the shared contract (`@launchstack/tools/company-context/schema`),
 * and re-exported here so this vertical and its consumers import one shape.
 * Every individual fact is a {@link MetadataFact} carrying visibility,
 * confidence, priority, provenance (with the quote and page it was read
 * from) and lifecycle.
 *
 * What stays here is this vertical's own surface: the value lists, the
 * extractor → merger contract, and the empty-document builder.
 */
import type {
    CompanyMetadataJSON,
    MetadataDiff,
    SourceFacts,
} from "@launchstack/tools/company-context/schema";

export type {
    ApplicantType,
    ChangeType,
    CompanyInfo,
    CompanyMetadataJSON,
    CompanyProfileSourceRow,
    DiffEntry,
    FactStatus,
    LabeledFact,
    LegalEntry,
    MarketsInfo,
    MetadataDiff,
    MetadataFact,
    MetadataSource,
    PersonEntry,
    Priority,
    ProfileInfo,
    ProjectEntry,
    ProvenanceInfo,
    ServiceEntry,
    SourceFacts,
    SourceOverride,
    SourcePassageCounts,
    SourceRole,
    SubprojectEntry,
    Usage,
    Visibility,
} from "@launchstack/tools/company-context/schema";
export {
    APPLICANT_TYPE_VALUES,
    CHANGE_TYPE_VALUES,
    SOURCE_OVERRIDE_VALUES,
    SOURCE_ROLE_VALUES,
} from "@launchstack/tools/company-context/schema";

export const VISIBILITY_VALUES = ["public", "partner", "private", "internal"] as const;

export const USAGE_VALUES = ["outreach_ok", "outreach_ok_with_approval", "no_outreach"] as const;

export const PRIORITY_VALUES = ["manual_override", "high", "normal", "low"] as const;

export const FACT_STATUS_VALUES = ["active", "deprecated", "superseded"] as const;

/** Profiles built by the source-sorting builder; older rows are rebuilt on request. */
export const METADATA_SCHEMA_VERSION = "1.1.0";

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
    facts: SourceFacts;
}

/**
 * Output of the merger: the updated canonical metadata plus a
 * machine-readable diff for the audit history table.
 */
export interface MergeResult {
    updatedMetadata: CompanyMetadataJSON;
    diff: MetadataDiff;
}

// ============================================================================
// Helpers
// ============================================================================

/** Build an empty metadata document for a newly-tracked company. */
export function createEmptyMetadata(companyId: string, now = new Date()): CompanyMetadataJSON {
    return {
        schema_version: METADATA_SCHEMA_VERSION,
        company_id: companyId,
        updated_at: now.toISOString(),
        company: {},
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: {},
        legal: [],
        profile: {},
        provenance: {
            total_documents_processed: 0,
            extraction_model: "",
            extraction_version: METADATA_SCHEMA_VERSION,
        },
    };
}
