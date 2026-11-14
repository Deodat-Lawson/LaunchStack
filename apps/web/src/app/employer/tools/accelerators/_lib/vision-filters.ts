import type { ProgramView, TrackerOpportunity, TrackerPriority } from "../api";
import { hasFacet, publishedValue, type ProgramDetailsMap } from "./details";

/**
 * Facets over sourced Program dossiers, saved fit and the saved tracker.
 * Applied after the catalogue filters in discovery.ts; OR within a facet, AND
 * across facets. Unknown facts never satisfy a facet.
 */
export const DEADLINE_WINDOWS = ["any", "30", "90"] as const;
export const DEAL_FILTERS = ["any", "equity_free", "fixed_equity"] as const;
export const TRACK_FILTERS = ["any", "tracked", "pending", "untracked"] as const;
export const PRIORITY_FILTERS = ["any", "high", "medium", "low"] as const;
export const SORTS = ["fit", "deadline", "name", "priority"] as const;

export interface VisionFilters {
    sectors: string[];
    stage: string;
    region: string;
    technology: string;
    businessModel: string;
    customerType: string;
    instrument: string;
    benefit: string;
    deadline: (typeof DEADLINE_WINDOWS)[number];
    deal: (typeof DEAL_FILTERS)[number];
    tracked: (typeof TRACK_FILTERS)[number];
    priority: (typeof PRIORITY_FILTERS)[number];
    sort: (typeof SORTS)[number];
    includeIneligible: boolean;
}

export const DEFAULT_VISION_FILTERS: VisionFilters = {
    sectors: [],
    stage: "any",
    region: "any",
    deadline: "any",
    technology: "any",
    businessModel: "any",
    customerType: "any",
    instrument: "any",
    benefit: "any",
    deal: "any",
    tracked: "any",
    priority: "any",
    sort: "fit",
    includeIneligible: false,
};

export const VISION_PARAM_KEYS = [
    "sector",
    "stage",
    "region",
    "technology",
    "businessModel",
    "customerType",
    "instrument",
    "benefit",
    "deadline",
    "deal",
    "tracked",
    "priority",
    "sort",
    "ineligible",
] as const;

/** Applied or interviewing: waiting on the accelerator's decision. A view, not a stored status. */
export function isPending(opportunity: TrackerOpportunity): boolean {
    return opportunity.status === "applied" || opportunity.status === "interviewing";
}

function pick<T extends string>(options: readonly T[], value: string | null, fallback: T): T {
    return options.find(option => option === value) ?? fallback;
}

export function readVisionFilters(params: URLSearchParams): VisionFilters {
    const sectors = (params.get("sector") ?? "").split(",").filter(Boolean);
    return {
        sectors,
        stage: params.get("stage") ?? "any",
        region: params.get("region") ?? "any",
        technology: params.get("technology") ?? "any",
        businessModel: params.get("businessModel") ?? "any",
        customerType: params.get("customerType") ?? "any",
        instrument: params.get("instrument") ?? "any",
        benefit: params.get("benefit") ?? "any",
        deadline: pick(DEADLINE_WINDOWS, params.get("deadline"), "any"),
        deal: pick(DEAL_FILTERS, params.get("deal"), "any"),
        tracked: pick(TRACK_FILTERS, params.get("tracked"), "any"),
        priority: pick(PRIORITY_FILTERS, params.get("priority"), "any"),
        sort: pick(SORTS, params.get("sort"), "fit"),
        includeIneligible: params.get("ineligible") === "include",
    };
}

export function updateVisionParams(
    params: URLSearchParams,
    patch: Partial<VisionFilters>
): URLSearchParams {
    const next = new URLSearchParams(params);
    const merged = { ...readVisionFilters(params), ...patch };
    const values: Record<(typeof VISION_PARAM_KEYS)[number], string | null> = {
        sector: merged.sectors.length > 0 ? merged.sectors.join(",") : null,
        stage: merged.stage === "any" ? null : merged.stage,
        region: merged.region === "any" ? null : merged.region,
        technology: merged.technology === "any" ? null : merged.technology,
        businessModel: merged.businessModel === "any" ? null : merged.businessModel,
        customerType: merged.customerType === "any" ? null : merged.customerType,
        instrument: merged.instrument === "any" ? null : merged.instrument,
        benefit: merged.benefit === "any" ? null : merged.benefit,
        deadline: merged.deadline === "any" ? null : merged.deadline,
        deal: merged.deal === "any" ? null : merged.deal,
        tracked: merged.tracked === "any" ? null : merged.tracked,
        priority: merged.priority === "any" ? null : merged.priority,
        sort: merged.sort === "fit" ? null : merged.sort,
        ineligible: merged.includeIneligible ? "include" : null,
    };
    for (const key of VISION_PARAM_KEYS) {
        const value = values[key];
        if (value === null) next.delete(key);
        else next.set(key, value);
    }
    return next;
}

const PRIORITY_RANK: Record<TrackerPriority, number> = { high: 0, medium: 1, low: 2 };

function topPriority(opportunities: TrackerOpportunity[]): TrackerPriority | null {
    return (
        [...opportunities].sort(
            (left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
        )[0]?.priority ?? null
    );
}

/** Only published, dated dossier values are deadlines; prose about cadence is not. */
export function nextDeadline(
    program: ProgramView["program"],
    details: ProgramDetailsMap,
    today: string
): string | null {
    return (
        details[program.id]?.batches.cycles
            .flatMap(cycle => {
                const value = publishedValue(cycle.announcedDeadline);
                const date = value?.dateOnly ?? value?.at?.slice(0, 10);
                return date && date >= today ? [date] : [];
            })
            .sort()[0] ?? null
    );
}

export function daysBetween(from: string, to: string): number {
    return Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    );
}

export function applyVisionFilters(
    views: readonly ProgramView[],
    filters: VisionFilters,
    context: { details: ProgramDetailsMap; tracker: readonly TrackerOpportunity[]; today: string }
): ProgramView[] {
    const { details: allDetails, tracker, today } = context;
    const trackedBy = new Map<string, TrackerOpportunity[]>();
    for (const opportunity of tracker) {
        trackedBy.set(opportunity.programId, [
            ...(trackedBy.get(opportunity.programId) ?? []),
            opportunity,
        ]);
    }
    const kept = views.filter(view => {
        const id = view.program.id;
        const details = allDetails[id];
        const mine = trackedBy.get(id) ?? [];
        if (!filters.includeIneligible && isConfirmedIneligible(view)) return false;
        if (
            filters.sectors.length &&
            !filters.sectors.some(sector => hasFacet(details, ["sector"], sector))
        )
            return false;
        if (filters.stage !== "any" && !hasFacet(details, ["stage"], filters.stage)) return false;
        if (filters.region !== "any" && !hasFacet(details, ["geography"], filters.region))
            return false;
        for (const [key, facet] of [
            ["technology", "technology"],
            ["businessModel", "business_model"],
            ["customerType", "customer_type"],
            ["instrument", "instrument"],
            ["benefit", "benefit"],
        ] as const) {
            if (filters[key] !== "any" && !hasFacet(details, [facet], filters[key])) return false;
        }
        if (filters.deadline !== "any") {
            const deadline = nextDeadline(view.program, allDetails, today);
            if (!deadline || daysBetween(today, deadline) > Number(filters.deadline)) return false;
        }
        if (filters.deal !== "any") {
            const equity = publishedValue(details?.deal.equity);
            if (!equity?.length) return false;
            const percentages = equity
                .map(value => /^(\d+(?:\.\d+)?)\s*%$/.exec(value.trim())?.[1])
                .filter((value): value is string => value !== undefined)
                .map(Number);
            if (
                filters.deal === "equity_free" &&
                !(percentages.length > 0 && percentages.every(value => value === 0))
            )
                return false;
            if (filters.deal === "fixed_equity" && !percentages.some(value => value > 0))
                return false;
        }
        if (filters.tracked === "tracked" && mine.length === 0) return false;
        if (filters.tracked === "untracked" && mine.length > 0) return false;
        if (filters.tracked === "pending" && !mine.some(isPending)) return false;
        if (filters.priority !== "any" && topPriority(mine) !== filters.priority) return false;
        return true;
    });

    if (filters.sort === "name") {
        return kept.sort((left, right) => left.program.name.localeCompare(right.program.name));
    }
    // Best fit keeps the order rankPrograms gave the catalogue; sort is stable, so
    // ties in the other orders keep it too.
    if (filters.sort === "fit") return kept;
    return kept.sort((left, right) => {
        if (filters.sort === "deadline") {
            const a = nextDeadline(left.program, allDetails, today) ?? "9999-12-31";
            const b = nextDeadline(right.program, allDetails, today) ?? "9999-12-31";
            return a.localeCompare(b);
        }
        const a = topPriority(trackedBy.get(left.program.id) ?? []);
        const b = topPriority(trackedBy.get(right.program.id) ?? []);
        return (a ? PRIORITY_RANK[a] : 3) - (b ? PRIORITY_RANK[b] : 3);
    });
}

/** Only a current result confirms ineligibility; an out-of-date one may no longer hold. */
export function isConfirmedIneligible(view: ProgramView): boolean {
    return view.freshness.status === "current" && view.fit?.eligibility.status === "ineligible";
}
