/**
 * Demo stand-in for work another workstream owns: ProgramDetails is the
 * richer, sourced Program record Workstream 1 (Tony) will collect. It is
 * labelled as demo output in the UI and is replaced, not extended, when that
 * work merges. Company fit is real (Workstream 2, rubric fit-v1).
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

/** What the homepage carries in place of Workstream 1's future data. */
export interface DemoLayer {
    details: Record<string, ProgramDetails>;
}
