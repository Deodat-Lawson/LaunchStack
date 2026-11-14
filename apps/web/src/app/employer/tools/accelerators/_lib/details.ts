import type {
    InformationSlot,
    ProgramIntelligence,
    ProgramTag,
    TagFacet,
} from "@launchstack/pipelines/accelerators/intelligence";

export interface DetailSource {
    title: string;
    url: string;
    checkedAt: string;
}

/** Preserve the dossier's states and evidence instead of filling gaps with estimates. */
export type DetailSlot<T> = InformationSlot<T> & { sources: DetailSource[] };
export type ProgramDetails = {
    identity: {
        [K in keyof ProgramIntelligence["identity"]]: ProgramIntelligence["identity"][K] & {
            sources: DetailSource[];
        };
    };
    audience: {
        [K in keyof ProgramIntelligence["audience"]]: ProgramIntelligence["audience"][K] & {
            sources: DetailSource[];
        };
    };
    contact: {
        [K in keyof ProgramIntelligence["contact"]]: ProgramIntelligence["contact"][K] & {
            sources: DetailSource[];
        };
    };
    batches: {
        cycles: {
            id: string;
            label: string;
            announcedDeadline: DetailSlot<
                NonNullable<
                    ProgramIntelligence["batches"]["cycles"][number]["announcedDeadline"]["value"]
                >
            >;
        }[];
        historicalCadence: DetailSlot<string>;
        announcedStarts: DetailSlot<string>;
        nextDeadline: DetailSlot<string>;
        residencyEnd: DetailSlot<string>;
    };
    selectivity: DetailSlot<NonNullable<ProgramIntelligence["selectivity"]["value"]>>;
    deal: {
        summary: DetailSlot<string>;
        formatted: DetailSlot<string>;
        cash: DetailSlot<string[]>;
        equity: DetailSlot<string[]>;
        instrument: DetailSlot<string[]>;
        benefits: DetailSlot<string[]>;
        comparable: DetailSlot<boolean>;
    };
    portfolio: DetailSlot<number>;
    tags: (ProgramTag & { sources: DetailSource[] })[];
    sources: DetailSource[];
    evidence: (DetailSource & { id: string })[];
};
export type ProgramDetailsMap = Record<string, ProgramDetails>;

export function publishedValue<T>(slot: InformationSlot<T> | undefined): T | null {
    return slot?.state === "available" || slot?.state === "partial" || slot?.state === "stale"
        ? slot.value
        : null;
}

const AUDIENCE_FACETS = {
    sector: "sectors",
    technology: "technologies",
    business_model: "businessModels",
    customer_type: "customerTypes",
    stage: "stages",
    geography: "geography",
} as const;

/** Include taxonomy tags and published slots; unknown values never become facets. */
export function facetOptions(
    details: ProgramDetailsMap,
    facets: readonly TagFacet[]
): { id: string; label: string }[] {
    const options = new Map<string, string>();
    for (const item of Object.values(details)) {
        for (const tag of item.tags) if (facets.includes(tag.facet)) options.set(tag.id, tag.label);
        for (const facet of facets) {
            const field = AUDIENCE_FACETS[facet as keyof typeof AUDIENCE_FACETS];
            if (field)
                for (const value of publishedValue(item.audience[field]) ?? []) {
                    if (
                        !item.tags.some(
                            tag =>
                                tag.facet === facet &&
                                tag.label.toLowerCase() === value.toLowerCase()
                        )
                    )
                        options.set(value, value);
                }
        }
    }
    return [...options]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function hasFacet(
    details: ProgramDetails | undefined,
    facets: readonly TagFacet[],
    value: string
): boolean {
    if (!details) return false;
    if (details.tags.some(tag => facets.includes(tag.facet) && tag.id === value)) return true;
    for (const facet of facets) {
        const field = AUDIENCE_FACETS[facet as keyof typeof AUDIENCE_FACETS];
        if (
            field &&
            publishedValue(details.audience[field])?.includes(value) &&
            !details.tags.some(
                tag => tag.facet === facet && tag.label.toLowerCase() === value.toLowerCase()
            )
        )
            return true;
    }
    return false;
}

/** Whether the Program has any known value for a facet, so the filter can act on it at all. */
export function knowsFacet(details: ProgramDetails | undefined, facet: TagFacet): boolean {
    if (!details) return false;
    if (details.tags.some(tag => tag.facet === facet)) return true;
    const field = AUDIENCE_FACETS[facet as keyof typeof AUDIENCE_FACETS];
    return !!field && (publishedValue(details.audience[field])?.length ?? 0) > 0;
}

export function hasRollingIntake(details: ProgramDetails | undefined): boolean {
    return (
        !!details &&
        details.batches.cycles.some(
            cycle => publishedValue(cycle.announcedDeadline)?.rolling === true
        )
    );
}
