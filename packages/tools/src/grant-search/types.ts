/**
 * grant-search — the vocabulary. A *grant opportunity* is one funder's open
 * call as a search found it: enough to decide whether to read further, never
 * the application itself. Amounts are USD; dates are ISO days.
 */

export const GRANT_SOURCES = ["grants_gov", "web"] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export type ApplicantType = "nonprofit" | "small_business" | "for_profit" | "individual" | "any";

export type OpportunityStatus = "posted" | "forecasted" | "closed" | "unknown";

export interface GrantSearchQuery {
    /** Focus words: "youth literacy", "climate resilience". Commas separate. */
    keywords: string[];
    applicantType?: ApplicantType;
    /** Which Grants.gov statuses to include (default both open kinds). */
    status?: "posted" | "forecasted" | "both";
    /** Free text for web queries only: "Oregon", "Sub-Saharan Africa". */
    geography?: string;
    /** Per source cap; the merged list is at most twice this. Default 20, max 50. */
    limit?: number;
    /** Set false to skip the web provider even when a key is configured. */
    includeWeb?: boolean;
    /** Set false to skip Grants.gov (the keyless source). */
    includeGrantsGov?: boolean;
}

export interface GrantOpportunity {
    source: GrantSource;
    /** Grants.gov opportunity id, or the page URL for a web result. */
    externalId: string;
    title: string;
    funder: string;
    url: string;
    summary: string | null;
    opensOn: string | null;
    closesOn: string | null;
    status: OpportunityStatus;
    amountMin: number | null;
    amountMax: number | null;
    eligibility: string | null;
    /** Funding categories or ALN programme numbers; free labels. */
    categories: string[];
    opportunityNumber: string | null;
}

export type SourceStatus = "ok" | "failed" | "off";

export interface GrantSourceReport {
    id: GrantSource;
    status: SourceStatus;
    found: number;
    detail: string | null;
}

export interface GrantSearchResult {
    opportunities: GrantOpportunity[];
    sources: GrantSourceReport[];
}
