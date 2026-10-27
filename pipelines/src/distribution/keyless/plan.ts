/**
 * Discovery plan with no paid provider: one OpenStreetMap query per
 * territory, for the kinds of place closest in meaning to who the segment
 * sells to (or, with no embedder, those sharing its words).
 */
import type { PlanInput } from "../plan";
import type { DiscoveryPlan, PlannedSourceQuery, ProgramRecord } from "../types";
import { countryName } from "./geo";
import { buyerBrief, type EmbedTexts } from "../semantic";
import { chooseOsmCategories, tagSelectorsFor } from "./osm";
import { osmVocabulary, type OsmCategory } from "./taginfo";

export const KEYLESS_PLAYBOOK_HASH = "keyless-plan/v2";
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

export interface KeylessPlanOptions {
    /** Embedder for picking OpenStreetMap categories by meaning; null → shared words. */
    embed?: EmbedTexts | null;
    /** OpenStreetMap's vocabulary; defaults to taginfo's (loaded once). */
    vocabulary?: () => Promise<OsmCategory[]>;
}

/** OpenStreetMap categories for the segment: by meaning when an embedder answers. */
export async function placeCategoriesFor(
    input: Pick<PlanInput, "program" | "partnerKinds">,
    options: KeylessPlanOptions = {}
): Promise<{ selectors: string[]; method: "semantic" | "lexical" }> {
    const vocabulary = await (options.vocabulary ?? osmVocabulary)();
    if (options.embed) {
        try {
            const selectors = await chooseOsmCategories(
                options.embed,
                buyerBrief(input.program, input.partnerKinds),
                vocabulary
            );
            if (selectors.length > 0) return { selectors, method: "semantic" };
        } catch (error) {
            console.warn("[distribution] category embedding failed; matching by words:", error);
        }
    }
    const keywords = keywordsFor(input.program);
    const topical = tagSelectorsFor(keywords, vocabulary);
    return {
        selectors:
            topical.length > 0
                ? topical
                : tagSelectorsFor([...keywords, ...input.partnerKinds], vocabulary),
        method: "lexical",
    };
}

export async function buildKeylessPlan(
    input: PlanInput,
    options: KeylessPlanOptions = {}
): Promise<DiscoveryPlan> {
    const keywords = keywordsFor(input.program);
    const kind = input.partnerKinds[0] ?? "distributor";
    const { selectors, method } = await placeCategoriesFor(input, options);
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
                rationale: `Places tagged ${selectors.length ? selectors.join(" ") : "as companies"} with a website in ${where}.`,
                categoryIds: selectors,
            });
        }
    }
    return {
        adjacentBrands: [],
        strategy: `Keyless plan: places in ${input.territories.map(t => countryName(t.country)).join(", ")} from OpenStreetMap, of the kinds ${method === "semantic" ? "closest in meaning to who you sell to" : "sharing words with what you sell"} (${selectors.join(" ") || "companies"}), then each one's own website, matched to the segment by ${method === "semantic" ? "meaning" : "shared words"}. No paid provider is involved.`,
        queries,
    };
}
