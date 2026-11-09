import type { ProgramView } from "@launchstack/pipelines/accelerators";

export const FIT_FILTERS = ["all", "scored", "unmatched", "unscorable", "stale"] as const;
export const MINIMUM_SCORES = [0, 25, 50, 75] as const;
export const INTAKE_FILTERS = ["all", "rolling", "dated", "unknown"] as const;

export interface DiscoveryFilters {
    q: string;
    fit: (typeof FIT_FILTERS)[number];
    minScore: (typeof MINIMUM_SCORES)[number] | null;
    intake: (typeof INTAKE_FILTERS)[number];
}

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
    q: "",
    fit: "all",
    minScore: null,
    intake: "all",
};

export function readDiscoveryFilters(params: URLSearchParams): DiscoveryFilters {
    const fit = params.get("fit");
    const minScore = params.get("minScore");
    const intake = params.get("intake");
    return {
        q: params.get("q") ?? "",
        fit: FIT_FILTERS.find(value => value === fit) ?? "all",
        minScore: MINIMUM_SCORES.find(value => String(value) === minScore) ?? null,
        intake: INTAKE_FILTERS.find(value => value === intake) ?? "all",
    };
}

export function updateDiscoveryParams(
    params: URLSearchParams,
    patch: Partial<DiscoveryFilters>
): URLSearchParams {
    const next = new URLSearchParams(params);
    for (const key of ["q", "fit", "minScore", "intake"] as const) {
        const value = patch[key];
        if (value === undefined) continue;
        if (value === DEFAULT_DISCOVERY_FILTERS[key]) next.delete(key);
        else next.set(key, String(value));
    }
    return next;
}

/** The overall score only while the result is current; an out-of-date score is not a fit. */
export function currentScore(view: ProgramView): number | null {
    return view.freshness.status === "current" ? (view.fit?.overall.score ?? null) : null;
}

/**
 * Default order: current scores high to low, then current results without
 * enough evidence, then out of date, then not assessed; ties by name.
 */
function fitRank(view: ProgramView): number {
    const score = currentScore(view);
    if (score !== null) return score;
    if (view.freshness.status === "current") return -1;
    return view.freshness.status === "out_of_date" ? -2 : -3;
}

export function rankPrograms(programs: readonly ProgramView[], locale: string): ProgramView[] {
    return [...programs].sort(
        (left, right) =>
            fitRank(right) - fitRank(left) ||
            left.program.name.localeCompare(right.program.name, locale)
    );
}

export function filterPrograms(
    programs: readonly ProgramView[],
    filters: DiscoveryFilters
): ProgramView[] {
    const terms = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return programs.filter(view => {
        const score = currentScore(view);
        const { status } = view.freshness;
        if (filters.fit === "scored" && score === null) return false;
        if (filters.fit === "unmatched" && status !== "not_assessed") return false;
        if (filters.fit === "unscorable" && (status !== "current" || score !== null)) return false;
        if (filters.fit === "stale" && status !== "out_of_date") return false;
        if (filters.minScore !== null && (score === null || score < filters.minScore)) return false;

        if (filters.intake !== "all") {
            const rolling = view.program.cycles.some(cycle => cycle.rolling);
            const dated = view.program.cycles.some(
                cycle => cycle.deadlineAt !== null || cycle.dateOnly !== undefined
            );
            if (filters.intake === "rolling" && !rolling) return false;
            if (filters.intake === "dated" && !dated) return false;
            if (filters.intake === "unknown" && (rolling || dated)) return false;
        }

        if (terms.length > 0) {
            const text = [
                view.program.name,
                view.program.description.text,
                view.program.targetApplicants.text,
                view.program.location?.text ?? "",
                ...view.program.cycles.map(cycle => cycle.label),
            ]
                .join(" ")
                .toLowerCase();
            if (!terms.every(term => text.includes(term))) return false;
        }
        return true;
    });
}
