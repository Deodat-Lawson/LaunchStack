/**
 * Companies like the ones a seller wants, where the seller wants them: the
 * Prospects discovery as a single synchronous call, for the MCP tool. Nothing
 * is stored; no segment, run or deal is created.
 *
 * - Where: the place as written ("Baltimore, MD") goes through OpenStreetMap's
 *   geocoder, or the offline reader when it cannot answer.
 * - Who: OpenStreetMap places of the kinds closest in meaning to the brief,
 *   plus Exa's company index when the deployment has a key.
 * - Fit: each company's own words are matched to the brief by meaning; the
 *   closest are checked by the workspace's chat model ("would this business
 *   buy this, here?"), which also rejects companies whose text puts them
 *   elsewhere.
 */
import {
    bestTerritoryFit,
    parsePlace,
    placeLabel,
} from "@launchstack/pipelines/distribution/locate";
import { geocodePlace } from "@launchstack/pipelines/distribution/geocode";
import {
    buyerBrief,
    companyText,
    createKeylessPorts,
    keywordsFor,
    mentionFromCompanyHit,
    placeCategoriesFor,
    relevanceOf,
    type EmbedTexts,
    type JudgeFit,
    type Territory,
} from "@launchstack/pipelines/distribution";
import {
    companySearchAvailable,
    searchCompanies,
    type CompanyHit,
} from "@launchstack/tools/web-research";

export interface SimilarCompaniesQuery {
    /** What the seller sells, in their words. */
    offering: string;
    /** Who buys it: kinds of business ("cafés", "specialty grocers"). */
    buyers?: string[];
    /** Where, as people write it: "Baltimore, MD", "Amsterdam", "Germany". */
    place: string;
    limit: number;
}

export interface SimilarCompany {
    name: string;
    website: string | null;
    address: string | null;
    country: string | null;
    region: string | null;
    categories: string[];
    /** Closeness to the brief by meaning; above 0 reads more like the buyer than business in general. */
    relevance: number;
    /** The fit check's reason, when it ran. */
    reason: string | null;
    source: "openstreetmap" | "exa";
}

export interface SimilarCompaniesResult {
    place: { country: string; region: string | null; label: string };
    matching: "semantic" | "lexical";
    companies: SimilarCompany[];
}

export interface SimilarCompaniesDeps {
    embed: EmbedTexts | null;
    judgeFit: JudgeFit | null;
    geocode?: typeof geocodePlace;
    /** OpenStreetMap places of the given kinds in the territory. */
    searchPlaces?: (args: {
        query: string;
        categoryIds: string[];
        territory: Territory;
    }) => Promise<
        Array<{
            name: string;
            website?: string;
            formattedAddress: string;
            categories: Array<{ id: string; name: string }>;
        }>
    >;
    /** OpenStreetMap's place vocabulary; defaults to taginfo's. */
    vocabulary?: () => Promise<Array<{ selector: string; description: string }>>;
    /** Exa's company index; null when not configured. */
    searchCompanies?: ((query: string, country: string) => Promise<CompanyHit[]>) | null;
}

export class SimilarCompaniesError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SimilarCompaniesError";
    }
}

/** How many of the closest companies the fit check reads, per result asked for. */
const JUDGE_POOL_FACTOR = 2;

function hostOf(url: string | undefined | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return null;
    }
}

export async function findSimilarCompanies(
    query: SimilarCompaniesQuery,
    deps: SimilarCompaniesDeps
): Promise<SimilarCompaniesResult> {
    const geocode = deps.geocode ?? geocodePlace;
    const territory = (await geocode(query.place)) ?? parsePlace(query.place);
    if (!territory)
        throw new SimilarCompaniesError(
            `Could not find "${query.place}". Name a city, region or country, e.g. "Baltimore, MD".`
        );

    const program = {
        offering: query.offering,
        categories: query.buyers ?? [],
        constraints: null,
    };
    const brief = buyerBrief(program, []);
    const { selectors } = await placeCategoriesFor(
        { program, partnerKinds: [] },
        {
            embed: deps.embed,
            ...(deps.vocabulary ? { vocabulary: deps.vocabulary } : {}),
        }
    );

    const searchPlaces =
        deps.searchPlaces ?? createKeylessPorts({ placesPerTerritory: 40 }).searchPlaces!;
    const exa =
        deps.searchCompanies === undefined
            ? companySearchAvailable()
                ? (q: string, country: string) =>
                      searchCompanies(q, { maxResults: 10, country, excludeDomains: [] })
                : null
            : deps.searchCompanies;

    const keywords = keywordsFor(program).join(" ") || query.offering.slice(0, 60);
    const where = placeLabel(territory);
    const [places, hits] = await Promise.all([
        searchPlaces({ query: keywords, categoryIds: selectors, territory }).catch(() => []),
        exa
            ? exa(
                  `${[...(query.buyers ?? []), query.offering].join(", ")} in ${where}`,
                  territory.country
              ).catch(() => [])
            : Promise.resolve([] as CompanyHit[]),
    ]);

    // One entry per site: a place search's area is real; a company hit's
    // location is only what its homepage says.
    const seen = new Set<string>();
    const candidates: Array<SimilarCompany & { description: string }> = [];
    for (const p of places) {
        const key = hostOf(p.website) ?? `name:${p.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
            name: p.name,
            website: p.website ?? null,
            address: p.formattedAddress || null,
            country: territory.country,
            region: territory.region ?? null,
            categories: p.categories.map(c => c.name),
            description: p.formattedAddress,
            relevance: 0,
            reason: null,
            source: "openstreetmap",
        });
    }
    for (const hit of hits) {
        const key = hostOf(hit.url) ?? `name:${hit.title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mention = mentionFromCompanyHit(hit, territory, "exa");
        candidates.push({
            name: mention.name,
            website: hit.url,
            address: null,
            country: mention.country ?? null,
            region: mention.region ?? null,
            categories: [],
            description: hit.description,
            relevance: 0,
            reason: null,
            source: "exa",
        });
    }

    const relevance = await relevanceOf(deps.embed, program, [], candidates);
    candidates.forEach((c, i) => (c.relevance = relevance.scores[i] ?? 0));
    const fitOf = (c: SimilarCompany) => bestTerritoryFit({ ...c, city: null }, [territory]);
    const RANK = { in: 2, unknown: 1, out: 0 } as const;
    const ranked = candidates
        .filter(c => c.relevance > 0 && fitOf(c) !== "out")
        .sort((a, b) => RANK[fitOf(b)] - RANK[fitOf(a)] || b.relevance - a.relevance);

    let kept = ranked;
    if (deps.judgeFit && ranked.length > 0) {
        const pool = ranked.slice(0, query.limit * JUDGE_POOL_FACTOR);
        try {
            const verdicts = await deps.judgeFit({
                brief,
                where,
                candidates: pool.map((c, i) => ({
                    id: String(i),
                    name: c.name,
                    text: companyText({
                        name: c.name,
                        categories: c.categories,
                        description: c.description,
                    }),
                })),
            });
            kept = pool.filter((c, i) => {
                const verdict = verdicts.get(String(i));
                if (verdict) c.reason = verdict.reason;
                return !verdict || verdict.fit;
            });
        } catch (error) {
            console.warn("[prospects/similar] fit check failed; ranking by meaning only:", error);
        }
    }

    return {
        place: { country: territory.country, region: territory.region ?? null, label: where },
        matching: relevance.method,
        companies: kept.slice(0, query.limit).map(({ description: _description, ...c }) => ({
            ...c,
            relevance: Math.round(c.relevance * 1000) / 1000,
        })),
    };
}
