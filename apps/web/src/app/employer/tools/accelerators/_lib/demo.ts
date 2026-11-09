/**
 * Demo stand-ins for work that other workstreams own:
 *  - ProgramDetails: the richer, sourced Program record Workstream 1 (Tony) will collect.
 *  - IllustrativeFit: the seven-dimension assessment Workstream 2 (Tiffany) will produce.
 * Both are labelled as demo output in the UI and are replaced, not extended,
 * when that work merges. See docs/plans/2026-11-03-0704-feat-accelerator-sourcing-requirements-plan.md.
 */

export const INVESTMENT_STAGES = ["idea", "pre_seed", "seed", "series_a", "later"] as const;
export type InvestmentStage = (typeof INVESTMENT_STAGES)[number];

export const SECTOR_TAGS = [
    "ai",
    "b2b_software",
    "developer_tools",
    "fintech",
    "healthcare",
    "biotech",
    "climate",
    "hardware",
    "robotics",
    "logistics",
    "consumer",
    "marketplaces",
    "education",
    "deep_tech",
    "space",
    "food_agriculture",
    "mobility",
    "social_impact",
] as const;
export type SectorTag = (typeof SECTOR_TAGS)[number];

export const REGIONS = [
    "north_america",
    "europe",
    "asia_pacific",
    "middle_east_africa",
    "latin_america",
    "global",
] as const;
export type Region = (typeof REGIONS)[number];

export const APPLY_ROUTES = [
    "online_application",
    "rolling_application",
    "referral",
    "email",
    "invitation",
] as const;
export type ApplyRoute = (typeof APPLY_ROUTES)[number];

export const OPERATING_STATUSES = ["active", "paused", "closed", "unknown"] as const;
export type OperatingStatus = (typeof OPERATING_STATUSES)[number];

export interface ProgramDetails {
    /** Whether the Program is operating, not whether applications are open. */
    operatingStatus: OperatingStatus;
    stages: InvestmentStage[];
    /** True when the Program states it backs companies in any sector. */
    generalist: boolean;
    /** Sectors the Program states it focuses on; empty for a generalist with no stated focus. */
    sectors: SectorTag[];
    regions: Region[];
    /** e.g. "In person in San Francisco". Null when unknown. */
    format: string | null;
    durationWeeks: number | null;
    /** Public program contact only; never a named person's private details. */
    contact: { email: string | null; phone: string | null; contactUrl: string | null };
    applyRoutes: ApplyRoute[];
    batches: {
        /** e.g. "Four batches a year: Winter, Spring, Summer and Fall". */
        cadence: string | null;
        /**
         * `announced`: the Program published this deadline. `expected`: inferred from
         * past cycles and shown as historical, never as the next deadline.
         */
        next: {
            label: string;
            deadline: string | null;
            deadlineKind: "announced" | "expected";
        } | null;
        recent: string[];
    };
    /** Acceptance rate only when the Program or a cited source reports one. */
    selectivity: { acceptanceRatePercent: number | null; note: string | null };
    /** Null when no terms are published. */
    deal: {
        /** One factual line, e.g. "$500k: $125k for 7% plus $375k on an uncapped MFN SAFE". */
        summary: string;
        cashUsd: number | null;
        /** Fixed equity only; contingent dilution (uncapped SAFEs, warrants) stays in `terms`. */
        equityPercent: number | null;
        instrument: string | null;
        /** The Deal and Economics page content as Markdown, quoting or closely following the source. */
        terms: string;
    } | null;
    sources: { title: string; url: string; checkedAt: string }[];
}

export const FIT_DIMENSIONS = [
    { key: "sector", weight: 20 },
    { key: "stage", weight: 15 },
    { key: "businessModel", weight: 15 },
    { key: "portfolio", weight: 15 },
    { key: "deal", weight: 15 },
    { key: "operations", weight: 10 },
    { key: "value", weight: 10 },
] as const;
export type FitDimensionKey = (typeof FIT_DIMENSIONS)[number]["key"];

export interface FitDimensionResult {
    /** Anchored rating 0/25/50/75/100; null when the evidence is unknown. */
    score: number | null;
    /** False only under a rubric rule, e.g. portfolio similarity outside the Supported accelerators. */
    applicable: boolean;
    note: string;
}

export interface IllustrativeFit {
    eligibility: "eligible" | "unknown" | "ineligible";
    eligibilityNote: string;
    dimensions: Record<FitDimensionKey, FitDimensionResult>;
}

/** Below this share of applicable weight with evidence, no overall score is shown. */
export const MIN_FIT_COVERAGE = 70;

/**
 * Weighted mean of rated dimensions and the share of applicable weight that
 * was rated. Unknown is excluded rather than scored, per the scoring spec.
 */
export function summarizeFit(fit: IllustrativeFit): { overall: number | null; coverage: number } {
    let applicableWeight = 0;
    let ratedWeight = 0;
    let weighted = 0;
    for (const { key, weight } of FIT_DIMENSIONS) {
        const dimension = fit.dimensions[key];
        if (!dimension.applicable) continue;
        applicableWeight += weight;
        if (dimension.score === null) continue;
        ratedWeight += weight;
        weighted += dimension.score * weight;
    }
    const coverage =
        applicableWeight === 0 ? 0 : Math.round((ratedWeight / applicableWeight) * 100);
    const overall =
        coverage >= MIN_FIT_COVERAGE && ratedWeight > 0 ? Math.round(weighted / ratedWeight) : null;
    return { overall, coverage };
}

/** What the homepage carries in place of the other workstreams' future data. */
export interface DemoLayer {
    details: Record<string, ProgramDetails>;
    /** Written for the Northwind demo company only; empty for every other company. */
    fits: Record<string, IllustrativeFit>;
}
