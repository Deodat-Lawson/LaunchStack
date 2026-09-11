/**
 * Owner-company data → template merge variables (member.md Phase 2).
 *
 * This is the deterministic half of grounding: the LLM in `generator.ts` writes
 * the prose, but the concrete values a template interpolates come from here, so
 * they are auditable and cannot be hallucinated.
 *
 * Anything absent is reported in `missing` rather than defaulted to filler —
 * a template referencing a field with no data must fail the unresolved-token
 * guard, not quietly send "our proven results" with nothing behind it.
 */
/** Merge variables this module can supply. */
export declare const COMPANY_FIELDS: readonly ["ownerCompany", "valueProp", "ownerIndustry", "differentiators", "proofPoint", "ctaLink"];
export type CompanyField = (typeof COMPANY_FIELDS)[number];
export interface CompanyMergeFields {
    /** Resolved fields, ready to spread into `createMerge({ companyFields })`. */
    fields: Partial<Record<CompanyField, string>>;
    /** Fields with no grounded value — a template must not reference these. */
    missing: CompanyField[];
    /** Where each resolved field came from, for the audit trail. */
    provenance: Partial<Record<CompanyField, "company" | "company_metadata">>;
}
/**
 * Build the owner company's merge fields.
 *
 * Reads the `company` row first (always present) then layers
 * `company_metadata` over it when a confident fact exists.
 */
export declare function buildCompanyMergeFields(companyId: number): Promise<CompanyMergeFields>;
/**
 * Which company fields a template actually needs.
 * Lets the UI warn "this template uses {{proofPoint}} but you have none" before
 * a single email is rendered.
 */
export declare function requiredCompanyFields(tokens: string[]): CompanyField[];
//# sourceMappingURL=company-fields.d.ts.map