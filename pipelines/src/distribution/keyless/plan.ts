/**
 * Deterministic discovery plan: no model, no key. One OpenStreetMap query
 * and one directory query per territory, built from the program's
 * categories (or, failing those, the words of its offering).
 */
import type { PlanInput } from "../plan";
import type { DiscoveryPlan, PlannedSourceQuery, ProgramRecord } from "../types";
import { countryName } from "./geo";
import { tagSelectorsFor } from "./osm";

export const KEYLESS_PLAYBOOK_HASH = "keyless-plan/v1";
export const KEYLESS_MODEL_ID = "keyless/deterministic-planner";

const STOP = new Set([
    "with",
    "from",
    "that",
    "this",
    "your",
    "their",
    "into",
    "and",
    "the",
    "for",
    "our",
    "per",
    "month",
    "year",
    "single",
    "origin",
    "roasted",
    "premium",
    "high",
    "quality",
    "based",
    "across",
    "using",
    "used",
    "make",
    "made",
]);

/** The words a segment is about: categories first, else the offering's nouns. */
export function keywordsFor(program: Pick<ProgramRecord, "categories" | "offering">): string[] {
    if (program.categories.length > 0) return program.categories.slice(0, 6);
    const words = program.offering
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 4 && !STOP.has(w));
    return [...new Set(words)].slice(0, 4);
}

export function buildKeylessPlan(input: PlanInput): DiscoveryPlan {
    const keywords = keywordsFor(input.program);
    const kind = input.partnerKinds[0] ?? "distributor";
    const selectors = tagSelectorsFor([...keywords, ...input.partnerKinds]);
    const queries: PlannedSourceQuery[] = [];
    for (const territory of input.territories) {
        const where = territory.region
            ? `${territory.region}, ${countryName(territory.country)}`
            : countryName(territory.country);
        if (input.sources.place) {
            queries.push({
                kind: "place",
                territory,
                partnerKind: kind,
                query: keywords.join(" ") || input.program.offering.slice(0, 60),
                label: "openstreetmap",
                rationale: `Organisations tagged ${selectors.length ? selectors.join(" ") : "as companies"} with a website in ${where}.`,
                categoryIds: selectors,
            });
        }
        if (input.sources.web) {
            queries.push({
                kind: "web",
                territory,
                partnerKind: kind,
                query: `${keywords.join(" ")} ${where} country:${territory.country}`,
                label: "directories",
                rationale: `Public directories (Y Combinator) filtered to ${where} and the segment's words.`,
            });
        }
    }
    return {
        adjacentBrands: [],
        strategy: `Keyless plan: ${keywords.length ? `looking for ${keywords.join(", ")}` : "using the offering's words"} in ${input.territories.map(t => countryName(t.country)).join(", ")} through OpenStreetMap and public directories, then reading each organisation's own website. No model and no paid provider is involved.`,
        queries,
    };
}
