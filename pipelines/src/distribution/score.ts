/**
 * Stage 7 — score. A deterministic rubric produces the number (design
 * §4.1 stage 7); the LLM writes the rationale from the rubric's inputs and
 * may not change it. Competitors of the seller, the seller itself and
 * excluded organisations score zero by rule.
 */
import type {
    Dossier,
    FitBreakdown,
    PartnerKind,
    PartnerOrgRecord,
    ProgramRecord,
    Territory,
} from "./types";

export interface ScoreInput {
    program: ProgramRecord;
    org: PartnerOrgRecord;
    kind: PartnerKind;
    territory: Territory | null;
    dossier: Dossier | null;
    evidenceCount: number;
    /** Newest evidence capture time, if any. */
    newestEvidenceAt: Date | null;
    /** Organisation is known from the tenant's own documents. */
    knownEntity: boolean;
    /** The seller's own name and known competitor names (lowercased). */
    sellerName: string;
    competitorNames?: string[];
    now?: Date;
}

const WEIGHTS = {
    categoryOverlap: 25,
    territoryMatch: 20,
    roleMatch: 20,
    evidenceDepth: 15,
    freshness: 5,
    sizeFit: 5,
    knownSignal: 10,
} as const;

function tokens(values: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const value of values) {
        for (const t of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (t.length > 2) out.add(t);
    }
    return out;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let hits = 0;
    for (const t of a) if (b.has(t)) hits += 1;
    return hits / Math.min(a.size, b.size);
}

export function computeFit(input: ScoreInput): FitBreakdown {
    const now = input.now ?? new Date();
    const orgName = input.org.name.toLowerCase();
    const zero = (why: string): FitBreakdown => ({
        categoryOverlap: 0,
        territoryMatch: 0,
        roleMatch: 0,
        evidenceDepth: 0,
        freshness: 0,
        sizeFit: 0,
        knownSignal: 0,
        total: 0,
        excludedBecause: why,
    });
    if (input.sellerName && orgName === input.sellerName.toLowerCase())
        return zero("This is the seller itself.");
    for (const competitor of input.competitorNames ?? []) {
        if (competitor && orgName === competitor.toLowerCase())
            return zero(`Named competitor: ${competitor}.`);
    }

    // Category overlap: program categories vs org categories + brands carried + evidence-derived categories.
    const programTerms = tokens([...input.program.categories, input.program.offering]);
    const orgTerms = tokens([
        ...input.org.categories,
        input.org.description ?? "",
        ...(input.dossier?.brandsCarried.map(b => b.brand) ?? []),
        input.dossier?.summary ?? "",
    ]);
    const categoryOverlap = Math.round(
        WEIGHTS.categoryOverlap * Math.min(1, overlapRatio(programTerms, orgTerms) * 1.5)
    );

    // Territory: org country equals the relationship territory (or any program territory).
    const targetCountries = new Set(input.program.targetTerritories.map(t => t.country));
    const wanted = input.territory?.country ?? null;
    const dossierTerritories = (input.dossier?.territories ?? []).map(t =>
        t.territory.toLowerCase()
    );
    let territoryMatch = 0;
    if (wanted && input.org.country === wanted) territoryMatch = WEIGHTS.territoryMatch;
    else if (input.org.country && targetCountries.has(input.org.country))
        territoryMatch = Math.round(WEIGHTS.territoryMatch * 0.8);
    else if (wanted && dossierTerritories.some(t => t.includes(wanted.toLowerCase())))
        territoryMatch = Math.round(WEIGHTS.territoryMatch * 0.7);
    else if (input.org.country === null) territoryMatch = Math.round(WEIGHTS.territoryMatch * 0.3);

    // Role: dossier roles (agent-established) beat mention-guessed roles.
    const roles = new Set<string>([...(input.dossier?.roles ?? []), ...input.org.roles]);
    const roleMatch = input.dossier?.roles.includes(input.kind)
        ? WEIGHTS.roleMatch
        : roles.has(input.kind)
          ? Math.round(WEIGHTS.roleMatch * 0.5)
          : 0;

    // Evidence depth: saturates at 12 items.
    const evidenceDepth = Math.round(WEIGHTS.evidenceDepth * Math.min(1, input.evidenceCount / 12));

    // Freshness: newest evidence within 90 days is full marks; decays to zero at 2 years.
    let freshness = 0;
    if (input.newestEvidenceAt) {
        const days = (now.getTime() - input.newestEvidenceAt.getTime()) / 86_400_000;
        freshness =
            days <= 90
                ? WEIGHTS.freshness
                : days >= 730
                  ? 0
                  : Math.round(WEIGHTS.freshness * (1 - (days - 90) / 640));
    }

    // Size fit: unknown gets half; micro for an importer program gets less.
    const band = input.dossier?.sizeBand ?? input.org.sizeBand ?? "unknown";
    const sizeFit =
        band === "unknown"
            ? Math.round(WEIGHTS.sizeFit * 0.5)
            : band === "micro" && input.kind !== "retailer"
              ? 1
              : WEIGHTS.sizeFit;

    const knownSignal = input.knownEntity ? WEIGHTS.knownSignal : 0;

    const total = Math.max(
        0,
        Math.min(
            100,
            categoryOverlap +
                territoryMatch +
                roleMatch +
                evidenceDepth +
                freshness +
                sizeFit +
                knownSignal
        )
    );
    return {
        categoryOverlap,
        territoryMatch,
        roleMatch,
        evidenceDepth,
        freshness,
        sizeFit,
        knownSignal,
        total,
    };
}

/** Risk flags derived from the dossier and the rubric — deterministic strings the UI can render. */
export function deriveRiskFlags(input: {
    dossier: Dossier | null;
    breakdown: FitBreakdown;
    evidenceCount: number;
    budgetExhausted: boolean;
}): string[] {
    const flags: string[] = [];
    if (input.breakdown.excludedBecause) flags.push(`excluded: ${input.breakdown.excludedBecause}`);
    if (input.evidenceCount === 0) flags.push("no evidence recorded");
    else if (input.evidenceCount < 3) flags.push("thin evidence");
    if (input.budgetExhausted) flags.push("research budget exhausted");
    for (const risk of input.dossier?.risks ?? []) flags.push(risk.risk);
    if (input.breakdown.roleMatch === 0) flags.push("role not confirmed");
    return [...new Set(flags)].slice(0, 12);
}

/** The rationale prompt body — the model sees only rubric inputs and the summary. */
export function buildRationaleInput(args: {
    breakdown: FitBreakdown;
    dossierSummary: string | null;
    kind: PartnerKind;
    territory: Territory | null;
    orgName: string;
}): string {
    const b = args.breakdown;
    return [
        `Organisation: ${args.orgName}`,
        `Wanted as: ${args.kind}${args.territory ? ` in ${args.territory.region ? `${args.territory.region}, ` : ""}${args.territory.country}` : ""}`,
        `Fit score: ${b.total}/100${b.excludedBecause ? ` (zeroed: ${b.excludedBecause})` : ""}`,
        `Rubric: category overlap ${b.categoryOverlap}/${WEIGHTS.categoryOverlap}, territory ${b.territoryMatch}/${WEIGHTS.territoryMatch}, role ${b.roleMatch}/${WEIGHTS.roleMatch}, evidence depth ${b.evidenceDepth}/${WEIGHTS.evidenceDepth}, freshness ${b.freshness}/${WEIGHTS.freshness}, size ${b.sizeFit}/${WEIGHTS.sizeFit}, known to us ${b.knownSignal}/${WEIGHTS.knownSignal}`,
        `Dossier summary: ${args.dossierSummary ?? "(no dossier)"}`,
    ].join("\n");
}

/** Fallback rationale when no model is available or the call fails: still true, just plainer. */
export function templateRationale(args: {
    breakdown: FitBreakdown;
    orgName: string;
    kind: PartnerKind;
}): string {
    const b = args.breakdown;
    if (b.excludedBecause) return `${args.orgName} scores 0: ${b.excludedBecause}`;
    const parts: Array<[string, number, number]> = [
        ["category overlap", b.categoryOverlap, WEIGHTS.categoryOverlap],
        ["territory", b.territoryMatch, WEIGHTS.territoryMatch],
        ["role", b.roleMatch, WEIGHTS.roleMatch],
        ["evidence depth", b.evidenceDepth, WEIGHTS.evidenceDepth],
        ["known to us", b.knownSignal, WEIGHTS.knownSignal],
    ];
    const sorted = [...parts].sort((x, y) => y[1] / y[2] - x[1] / x[2]);
    const strongest = sorted[0]!;
    const weakest = sorted[sorted.length - 1]!;
    return `${args.orgName} scores ${b.total}/100 as a ${args.kind}. Strongest: ${strongest[0]} (${strongest[1]}/${strongest[2]}). Main reservation: ${weakest[0]} (${weakest[1]}/${weakest[2]}).`;
}

export const FIT_WEIGHTS = WEIGHTS;
