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
export const VISIBILITY_VALUES = ["public", "partner", "private", "internal"];
export const USAGE_VALUES = ["outreach_ok", "outreach_ok_with_approval", "no_outreach"];
export const PRIORITY_VALUES = ["manual_override", "high", "normal", "low"];
export const FACT_STATUS_VALUES = ["active", "deprecated", "superseded"];
export const CHANGE_TYPE_VALUES = [
    "extraction",
    "merge",
    "manual_override",
    "deprecation",
];
// ============================================================================
// Helpers
// ============================================================================
/** Build an empty metadata document for a newly-tracked company. */
export function createEmptyMetadata(companyId) {
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
        legal: [],
        provenance: {
            total_documents_processed: 0,
            extraction_model: "",
            extraction_version: "1.0.0",
        },
    };
}
//# sourceMappingURL=types.js.map