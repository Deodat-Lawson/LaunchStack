/**
 * Companies like the ones a seller wants, where the seller wants them: the
 * Prospects discovery as a single synchronous call, for the MCP tool. Nothing
 * is stored; no segment, run or deal is created.
 *
 * - Where: each place as written ("Baltimore, MD") goes through
 *   OpenStreetMap's geocoder, or the offline reader when it cannot answer.
 *   Several places are searched at once.
 * - Who: OpenStreetMap places of the kinds closest in meaning to the brief,
 *   plus Exa's company index when the deployment has a key.
 * - Fit: each company's own words are matched to the brief by meaning. In
 *   thorough mode the closest companies' homepages are read first, for what
 *   they say about themselves and for their pictures. The workspace's chat
 *   model then checks them ("would this business buy this, here?") down the
 *   ranking until enough pass, rejecting competitors of the seller described,
 *   whatever was asked to be left out, and companies whose text puts them
 *   elsewhere.
 */
import type { ReadablePage } from "@launchstack/tools/web-research";
import {
    bestTerritoryFit,
    locateFromEvidence,
    parsePlace,
    placeLabel,
} from "@launchstack/pipelines/distribution/locate";
import { geocodePlace } from "@launchstack/pipelines/distribution/geocode";
import {
    buyerBrief,
    companyText,
    createKeylessPorts,
    keywordsFor,
    mapInPool,
    mentionFromCompanyHit,
    placeCategoriesFor,
    relevanceOf,
    type EmbedTexts,
    type JudgeFit,
    type ProgramRecord,
    type Territory,
} from "@launchstack/pipelines/distribution";
import {
    companySearchAvailable,
    fetchReadable,
    searchCompanies,
    type CompanyHit,
} from "@launchstack/tools/web-research";

export const SIMILAR_LIMITS = { places: 5, results: 25, exclude: 20 } as const;

export interface SimilarCompaniesQuery {
    /** What the seller sells, in their words. */
    offering: string;
    /** Who buys it: kinds of business ("cafés", "specialty grocers"). */
    buyers?: string[];
    /** Where, as people write them: "Baltimore, MD", "Amsterdam", "Germany". */
    places: string[];
    /** Domains to skip ("acme.com"), or kinds of business not wanted ("other roasters"). */
    exclude?: string[];
    /** Who is asking, so the fit check can tell a competitor from a buyer. */
    seller?: string;
    /** "thorough" reads each shortlisted homepage first; "quick" judges on listings alone. */
    depth?: "quick" | "thorough";
    limit: number;
}

export interface SimilarCompany {
    name: string;
    website: string | null;
    address: string | null;
    country: string | null;
    region: string | null;
    categories: string[];
    /** What the company says it does (its homepage in thorough mode, else its listing). */
    description: string | null;
    /** The homepage's own share image and icon (thorough mode). */
    imageUrl: string | null;
    iconUrl: string | null;
    /** Closeness to the brief by meaning; above 0 reads more like the buyer than business in general. */
    relevance: number;
    /** The fit check's reason, when it ran. */
    reason: string | null;
    /** The place asked for that this company was found in. */
    place: string;
    source: "openstreetmap" | "exa";
}

export interface SimilarCompaniesResult extends Record<string, unknown> {
    places: Array<{ asked: string; country: string; region: string | null; label: string }>;
    /** Places that could not be found, as asked. */
    unknownPlaces: string[];
    /** Places found, where no company passed (a slow or empty search, or none fit). */
    placesWithoutResults: string[];
    /** What limited this answer: a slow source, no company index, a step cut short. */
    warnings: string[];
    matching: "semantic" | "lexical";
    depth: "quick" | "thorough";
    /** Companies the fit check said no to, and why (up to 10), so a caller can see the reasoning. */
    leftOut: Array<{ name: string; website: string | null; reason: string }>;
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
    /** Time the whole call may take (default 55s); later steps shrink to fit. */
    budgetMs?: number;
    /** Reads a homepage in thorough mode; defaults to the guarded reader. */
    readPage?: (url: string) => Promise<ReadablePage>;
}

export class SimilarCompaniesError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SimilarCompaniesError";
    }
}

/** Companies the fit check reads per open place in the results, each round. */
const JUDGE_POOL_FACTOR = 2;
/** Homepages read at once in thorough mode. */
const READ_CONCURRENCY = 5;
/**
 * Time limits, so one slow source can't hold the call past what MCP clients
 * wait (about a minute): each place's search, each homepage, all the reading
 * together, and the rounds of the fit check.
 */
/** Company-index searches per place: one per kind of buyer named. */
const EXA_QUERIES_MAX = 3;
const PLACE_SEARCH_MS = 30_000;
/** The whole call, by default: what MCP clients usually wait. */
const BUDGET_MS = 55_000;
const PAGE_READ_MS = 6_000;
const READING_MS = 20_000;
const JUDGE_ROUNDS_MAX = 3;

/** `work`, or `fallback` once `ms` have passed; the work is not cancelled, only no longer awaited. */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        work.catch(() => fallback),
        new Promise<T>(resolve => {
            timer = setTimeout(() => resolve(fallback), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}
const DESCRIPTION_MAX = 600;

function hostOf(url: string | undefined | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return null;
    }
}

/** A domain-looking exclusion ("acme.com", "https://www.acme.com/x") as a bare host; null for a description. */
function excludedHost(entry: string): string | null {
    const trimmed = entry.trim().toLowerCase();
    if (!/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/.test(trimmed)) return null;
    return hostOf(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
}

type Candidate = SimilarCompany & { territory: Territory };

export async function findSimilarCompanies(
    query: SimilarCompaniesQuery,
    deps: SimilarCompaniesDeps
): Promise<SimilarCompaniesResult> {
    const startedAt = Date.now();
    const left = () => (deps.budgetMs ?? BUDGET_MS) - (Date.now() - startedAt);
    const warnings: string[] = [];
    const asked = [...new Set(query.places.map(p => p.trim()).filter(Boolean))].slice(
        0,
        SIMILAR_LIMITS.places
    );
    if (asked.length === 0) throw new SimilarCompaniesError("Name at least one place.");
    const geocode = deps.geocode ?? geocodePlace;
    const located = await Promise.all(
        asked.map(async place => ({
            place,
            territory: (await geocode(place)) ?? parsePlace(place),
        }))
    );
    const places = located.filter(
        (p): p is { place: string; territory: Territory } => p.territory !== null
    );
    const unknownPlaces = located.filter(p => p.territory === null).map(p => p.place);
    if (places.length === 0)
        throw new SimilarCompaniesError(
            `Could not find ${unknownPlaces.map(p => `"${p}"`).join(", ")}. Name a city, region or country, e.g. "Baltimore, MD".`
        );
    const territories = places.map(p => p.territory);

    const exclude = (query.exclude ?? []).slice(0, SIMILAR_LIMITS.exclude);
    const excludedHosts = new Set(exclude.map(excludedHost).filter((h): h is string => !!h));
    const notWanted = exclude.filter(e => excludedHost(e) === null);
    const program = {
        offering: query.offering,
        categories: query.buyers ?? [],
        constraints: notWanted.length > 0 ? `Not wanted: ${notWanted.join("; ")}.` : null,
    };
    const seller = query.seller?.trim() ? { identity: query.seller.trim() } : null;
    const brief = buyerBrief(program, [], seller);
    // Only a segment's offering, categories and constraints are read here.
    const { selectors } = await placeCategoriesFor(
        { program: program as ProgramRecord, partnerKinds: [] },
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
                      searchCompanies(q, {
                          maxResults: 10,
                          country,
                          excludeDomains: [...excludedHosts],
                      })
                : null
            : deps.searchCompanies;
    const keywords = keywordsFor(program).join(" ") || query.offering.slice(0, 60);
    // The index finds companies like the words given, so it is asked for the
    // buyers, one kind at a time — naming the offering would find its sellers.
    const exaQueries = (
        query.buyers && query.buyers.length > 0
            ? query.buyers.slice(0, EXA_QUERIES_MAX)
            : [`businesses that buy ${query.offering.slice(0, 120)}`]
    ).map(q => q.trim());

    if (!exa)
        warnings.push(
            "No company index (Exa) is configured, so companies come from OpenStreetMap alone, which is slower and covers fewer businesses."
        );
    const TIMED_OUT = Symbol("timed out");
    const searchFor = Math.min(PLACE_SEARCH_MS, Math.max(5_000, left() - 20_000));
    // Every place at once: its places and, with a key, its company-index hits.
    const found = await Promise.all(
        places.map(async ({ place, territory }) => {
            const [osmOrTimeout, hits] = await Promise.all([
                within<typeof TIMED_OUT | Awaited<ReturnType<typeof searchPlaces>>>(
                    searchPlaces({ query: keywords, categoryIds: selectors, territory }),
                    searchFor,
                    TIMED_OUT
                ),
                exa
                    ? Promise.all(
                          exaQueries.map(q =>
                              within(
                                  exa(`${q} in ${placeLabel(territory)}`, territory.country).catch(
                                      (error: unknown) => {
                                          warnings.push(
                                              `The company index (Exa) failed for ${place}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`
                                          );
                                          return [] as CompanyHit[];
                                      }
                                  ),
                                  searchFor,
                                  [] as CompanyHit[]
                              )
                          )
                      ).then(lists => lists.flat())
                    : Promise.resolve([] as CompanyHit[]),
            ]);
            if (osmOrTimeout === TIMED_OUT)
                warnings.push(
                    `OpenStreetMap did not answer for ${place} within ${Math.round(searchFor / 1000)}s (its public servers are slow at times), so its local listings are missing.`
                );
            const osm = osmOrTimeout === TIMED_OUT ? [] : osmOrTimeout;
            return { place, territory, osm, hits };
        })
    );

    // One entry per site. A place search's area is real; a company hit's
    // location is only what its homepage says.
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    const add = (key: string, c: Candidate) => {
        if (seen.has(key) || excludedHosts.has(key)) return;
        seen.add(key);
        candidates.push(c);
    };
    for (const { place, territory, osm, hits } of found) {
        for (const p of osm)
            add(hostOf(p.website) ?? `name:${p.name.toLowerCase()}`, {
                name: p.name,
                website: p.website ?? null,
                address: p.formattedAddress || null,
                country: territory.country,
                region: territory.region ?? null,
                categories: p.categories.map(c => c.name),
                description: null,
                imageUrl: null,
                iconUrl: null,
                relevance: 0,
                reason: null,
                place,
                source: "openstreetmap",
                territory,
            });
        for (const hit of hits) {
            const mention = mentionFromCompanyHit(hit, territory, "exa");
            add(hostOf(hit.url) ?? `name:${hit.title.toLowerCase()}`, {
                name: mention.name ?? hit.title,
                website: hit.url,
                address: null,
                country: mention.country ?? null,
                region: mention.region ?? null,
                categories: [],
                description: hit.description.slice(0, DESCRIPTION_MAX) || null,
                imageUrl: null,
                iconUrl: null,
                relevance: 0,
                reason: null,
                place,
                source: "exa",
                territory,
            });
        }
    }

    const textOf = (c: Candidate) =>
        companyText({
            name: c.name,
            categories: c.categories,
            description: c.description ?? c.address ?? "",
        });
    const score = async (list: Candidate[]) => {
        const r = await relevanceOf(deps.embed, program, [], list, seller);
        list.forEach((c, i) => (c.relevance = r.scores[i] ?? 0));
        return r.method;
    };
    const fitOf = (c: Candidate) => bestTerritoryFit({ ...c, city: null }, territories);
    const RANK = { in: 2, unknown: 1, out: 0 } as const;
    const byRank = (a: Candidate, b: Candidate) =>
        RANK[fitOf(b)] - RANK[fitOf(a)] || b.relevance - a.relevance;

    let matching = await score(candidates);
    let ranked = candidates.filter(c => c.relevance > 0 && fitOf(c) !== "out").sort(byRank);

    // Thorough: read what the closest companies say about themselves, then
    // score again on that, before anyone is judged.
    const depth = query.depth ?? "thorough";
    if (depth === "thorough" && ranked.length > 0) {
        const read =
            deps.readPage ?? ((url: string) => fetchReadable(url, { timeoutMs: PAGE_READ_MS }));
        const toRead = ranked.slice(0, query.limit * JUDGE_POOL_FACTOR).filter(c => c.website);
        const reading = mapInPool(toRead, READ_CONCURRENCY, async c => {
            const page = await read(c.website!).catch(() => null);
            if (!page || page.status >= 400) return;
            const words = `${page.title ?? ""} ${page.text}`.replace(/\s+/g, " ").trim();
            if (words) c.description = words.slice(0, DESCRIPTION_MAX);
            c.imageUrl = page.image ?? null;
            c.iconUrl = page.icon ?? null;
            if (c.source === "exa") {
                const seen = locateFromEvidence(words, c.territory);
                if (seen.country) [c.country, c.region] = [seen.country, seen.region];
            }
        });
        // Whatever is read in time counts; the rest is judged on its listing.
        const readFor = Math.min(READING_MS, left() - 15_000);
        if (readFor > 0) await within(reading, readFor, []);
        if (readFor < READING_MS)
            warnings.push(
                "Homepage reading was cut short to answer in time; some companies were judged on their listing."
            );
        matching = await score(ranked);
        ranked = ranked.filter(c => c.relevance > 0 && fitOf(c) !== "out").sort(byRank);
    }

    // The fit check down the ranking, round by round, until enough pass.
    const leftOut: SimilarCompaniesResult["leftOut"] = [];
    let kept: Candidate[] = ranked.slice(0, query.limit);
    if (deps.judgeFit && ranked.length > 0) {
        kept = [];
        let at = 0;
        try {
            let rounds = 0;
            while (
                at < ranked.length &&
                kept.length < query.limit &&
                rounds < JUDGE_ROUNDS_MAX &&
                (rounds === 0 || left() > 12_000)
            ) {
                rounds += 1;
                const batch = ranked.slice(
                    at,
                    at + (query.limit - kept.length) * JUDGE_POOL_FACTOR
                );
                at += batch.length;
                const verdicts = await deps.judgeFit({
                    brief,
                    where: [...new Set(territories.map(placeLabel))].join("; "),
                    seller,
                    candidates: batch.map((c, i) => ({
                        id: String(i),
                        name: c.name,
                        text: textOf(c),
                    })),
                });
                batch.forEach((c, i) => {
                    const verdict = verdicts.get(String(i));
                    if (verdict) c.reason = verdict.reason;
                    if (verdict && !verdict.fit) {
                        if (leftOut.length < 10)
                            leftOut.push({
                                name: c.name,
                                website: c.website,
                                reason: verdict.reason,
                            });
                    } else if (kept.length < query.limit) kept.push(c);
                });
            }
        } catch (error) {
            console.warn("[prospects/similar] fit check failed; ranking by meaning only:", error);
            for (const c of ranked.slice(at)) if (kept.length < query.limit) kept.push(c);
        }
    }

    return {
        places: places.map(({ place, territory }) => ({
            asked: place,
            country: territory.country,
            region: territory.region ?? null,
            label: placeLabel(territory),
        })),
        unknownPlaces,
        placesWithoutResults: places.map(p => p.place).filter(p => !kept.some(c => c.place === p)),
        matching,
        warnings,
        depth,
        leftOut,
        companies: kept.map(({ territory: _territory, ...c }) => ({
            ...c,
            relevance: Math.round(c.relevance * 1000) / 1000,
        })),
    };
}
