/**
 * Stage 3 — gather. Executes the plan across the sources with allSettled
 * semantics: a source that fails contributes nothing and is reported; only
 * all sources failing fails the stage (the caller decides). Output is
 * *mentions* — raw sightings of organisations — for the resolver.
 *
 * The web source prefers Exa's company index (`searchCompanies`): every hit
 * is a company's own homepage, so a key finds companies rather than the
 * publishers that wrote about them. Without it, general web search, and the
 * host of each result stands for the organisation. Lookalikes — companies
 * like the program's customers — need the company index too.
 */
import type { OrgMention } from "@launchstack/tools/org-resolver";
import { normalizeDomain } from "@launchstack/tools/org-resolver";
import type { TradeDataProvider } from "@launchstack/tools/trade-data";
import type {
    CompanyDescription,
    CompanyHit,
    RawSearchResult,
} from "@launchstack/tools/web-research";

import {
    MAX_LOOKALIKE_SEEDS,
    type PartnerKind,
    type PlannedSourceQuery,
    type SourceCount,
    type Territory,
} from "./types";

export interface CompanySearchPortOptions {
    /** Two-letter country code the vendor ranks first. */
    country?: string;
    /** Hosts never returned: exclusions, customers and lookalike seeds. */
    excludeDomains: readonly string[];
    signal?: AbortSignal;
}

/** One company search; the vendor never returns an excluded host. */
export type SearchCompaniesPort = (
    query: string,
    options: CompanySearchPortOptions
) => Promise<CompanyHit[]>;

/** What each company sells and to whom, from its homepage. */
export type DescribeCompaniesPort = (
    urls: string[],
    signal?: AbortSignal
) => Promise<CompanyDescription[]>;

/** The companies a run looks for lookalikes of. */
export interface LookalikeInput {
    /** Bare domains, most important first; at most MAX_LOOKALIKE_SEEDS are searched. */
    seeds: string[];
    /** The run's one country, when it has exactly one. */
    country: string | null;
    /** The role a lookalike gets when its homepage names none. */
    partnerKind: PartnerKind;
}

export interface GatherPorts {
    /** Web search over planned queries; null when unavailable. */
    searchWeb: ((queries: PlannedSourceQuery[]) => Promise<RawSearchResult[]>) | null;
    /** Company search (Exa); when set, web queries go through it instead of `searchWeb`. */
    searchCompanies?: SearchCompaniesPort | null;
    /** Seed descriptions for lookalikes (Exa). */
    describeCompanies?: DescribeCompaniesPort | null;
    /** Domains company search must never return. */
    excludeDomains?: readonly string[];
    lookalikes?: LookalikeInput | null;
    /** Place search for one planned place query; null when unavailable. */
    searchPlaces:
        | ((query: PlannedSourceQuery) => Promise<
              Array<{
                  fsqId: string;
                  name: string;
                  website?: string;
                  formattedAddress: string;
                  location: { lat: number; lng: number };
                  categories: Array<{ id: string; name: string }>;
                  /** Roles the directory's own tags establish; the query's kind is the fallback. */
                  roles?: PartnerKind[];
              }>
          >)
        | null;
    tradeData: TradeDataProvider | null;
    /** HS codes and keywords for trade queries. */
    hsCodes: string[];
    signal?: AbortSignal;
}

export interface GatherResult {
    mentions: OrgMention[];
    sources: SourceCount[];
    /** Search results kept so the enrich stage can seed candidate pages. */
    webResults: RawSearchResult[];
}

/** Which planned query produced a web result: keyed by URL. */
export interface MentionOrigin {
    query: PlannedSourceQuery;
}

/** The parts of a "Name | Tagline" page title, trimmed, empty ones dropped. */
function titleSegments(title: string): string[] {
    return title
        .split(/\s[|–—-]\s/)
        .map(part => part.trim())
        .filter(Boolean);
}

/** The organisation half of a "Name | Tagline" page title. */
function firstSegment(title: string): string {
    return titleSegments(title)[0] ?? title;
}

/** Title segments that name the page, not the company ("Home | Acme"). */
const GENERIC_SEGMENT =
    /^(home(\s?page)?|welcome|start(seite)?|accueil|inicio|início|homepagina|official (web)?site)$/i;

/**
 * A company's name from its homepage title: the first segment that is not
 * "Home" or "Welcome", without a "Welcome to" lead-in. A title that is only
 * a URL leaves the domain, which the resolver replaces with a real name
 * when another sighting has one.
 */
export function companyName(title: string, domain: string): string {
    const trimmed = title.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return domain;
    const segments = titleSegments(trimmed);
    const named = segments.find(part => !GENERIC_SEGMENT.test(part)) ?? segments[0] ?? trimmed;
    const name = named.replace(/^welcome to\s+/i, "").trim();
    return name || domain;
}

function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

function guessRolesFromText(text: string): string[] {
    const t = text.toLowerCase();
    const roles: string[] = [];
    if (/\b(importer|import\b|importeur|importador|importateur)/.test(t)) roles.push("importer");
    if (/\b(distributor|distribution|vertrieb|distributeur|distribuidor|distributore)/.test(t))
        roles.push("distributor");
    if (/\b(wholesale|wholesaler|großhandel|grossist|groothandel|mayorista|grossiste)/.test(t))
        roles.push("wholesaler");
    if (/\b(retailer|retail|einzelhandel|winkel|tienda|boutique|store)\b/.test(t))
        roles.push("retailer");
    if (/\b(agent|agency|handelsvertreter|agente)\b/.test(t)) roles.push("agent");
    return roles;
}

/**
 * Turn a web search result into a mention. The result's own site is the
 * organisation when the page is a company page; directory and press pages
 * become mentions of whoever they name in the title. Deciding that is the
 * enrich agent's job; here we record what we saw.
 */
export function mentionFromWebResult(
    result: RawSearchResult,
    query: PlannedSourceQuery
): OrgMention {
    const host = hostOf(result.url);
    const trimmedTitle = result.title?.trim();
    const title = trimmedTitle?.length ? trimmedTitle : (host ?? result.url);
    const roles = guessRolesFromText(`${result.title} ${result.content.slice(0, 400)}`);
    return {
        name: firstSegment(title),
        url: result.url,
        country: query.territory.country,
        region: query.territory.region ?? null,
        roles: roles.length > 0 ? roles : [query.partnerKind],
        categories: [],
        description: result.content.slice(0, 280),
        source: `web:${query.label}`,
    };
}

/**
 * A company-index hit as a mention. The hit is the company's own homepage,
 * so the hit is the organisation; its homepage text says what it does.
 */
export function mentionFromCompanyHit(
    hit: CompanyHit,
    origin: { country: string | null; region?: string | null; partnerKind: PartnerKind },
    source: string
): OrgMention {
    const roles = guessRolesFromText(`${hit.title} ${hit.description.slice(0, 400)}`);
    return {
        name: companyName(hit.title, hit.domain),
        url: hit.url,
        country: origin.country,
        region: origin.region ?? null,
        roles: roles.length > 0 ? roles : [origin.partnerKind],
        categories: [],
        description: hit.description.slice(0, 280),
        source,
    };
}

/**
 * The companies a run looks for lookalikes of: the customers the program
 * names (the newest entry first, since the list is appended to), then its
 * won deals (most recently won first), each domain once, capped.
 */
export function lookalikeSeeds(
    customerDomains: readonly string[],
    wonDomains: readonly string[],
    max = MAX_LOOKALIKE_SEEDS
): string[] {
    const seeds: string[] = [];
    for (const raw of [...[...customerDomains].reverse(), ...wonDomains]) {
        const domain = normalizeDomain(raw);
        if (domain && !seeds.includes(domain)) seeds.push(domain);
    }
    return seeds.slice(0, max);
}

const MAX_LOOKALIKE_QUERY = 300;

/** "Companies similar to Acme: what Acme sells and to whom", kept under ~300 characters. */
export function lookalikeQuery(name: string, description: string | null): string {
    const query = description?.trim()
        ? `Companies similar to ${name}: ${description.trim()}`
        : `Companies similar to ${name}`;
    if (query.length <= MAX_LOOKALIKE_QUERY) return query;
    const cut = query.slice(0, MAX_LOOKALIKE_QUERY);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > MAX_LOOKALIKE_QUERY / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Run `fn` over `items` a few at a time, stopping between batches on abort. */
async function settleInBatches<T, R>(
    items: readonly T[],
    size: number,
    fn: (item: T) => Promise<R>,
    signal?: AbortSignal
): Promise<Array<PromiseSettledResult<R>>> {
    const settled: Array<PromiseSettledResult<R>> = [];
    for (let i = 0; i < items.length; i += size) {
        if (signal?.aborted) break;
        settled.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
    }
    return settled;
}

/** Concurrent company searches: the vendor rate-limits bursts. */
const COMPANY_SEARCH_CONCURRENCY = 4;

function errorText(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

export async function gather(
    plan: PlannedSourceQuery[],
    ports: GatherPorts
): Promise<GatherResult> {
    const webQueries = plan.filter(q => q.kind === "web");
    const placeQueries = plan.filter(q => q.kind === "place");
    const tradeQueries = plan.filter(q => q.kind === "trade");

    const mentions: OrgMention[] = [];
    const sources: SourceCount[] = [];
    let webResults: RawSearchResult[] = [];

    const tasks: Promise<void>[] = [];
    // Company search is told what to leave out; a hit on an excluded domain
    // (or a subdomain of one) is still dropped here, whatever the vendor did.
    const excluded = excludedDomainsOf(ports.excludeDomains ?? []);

    // ── web ──
    tasks.push(
        (async () => {
            if (webQueries.length === 0) {
                sources.push({
                    source: "web",
                    queries: 0,
                    results: 0,
                    status: "skipped",
                    detail: "no web queries planned",
                });
                return;
            }
            if (ports.searchCompanies) {
                const found = await gatherCompanies(
                    webQueries,
                    ports.searchCompanies,
                    excluded,
                    ports.signal
                );
                mentions.push(...found.mentions);
                webResults = found.webResults;
                sources.push(found.source);
                return;
            }
            if (!ports.searchWeb) {
                sources.push({
                    source: "web",
                    queries: webQueries.length,
                    results: 0,
                    status: "skipped",
                    detail: "web search not configured",
                });
                return;
            }
            try {
                const results = await ports.searchWeb(webQueries);
                webResults = results;
                // Attribute each result to the first query whose territory it shares
                // (executeSearch dedupes across queries, so exact attribution is lost).
                const byCountry = new Map<string, PlannedSourceQuery>();
                for (const q of webQueries)
                    if (!byCountry.has(q.territory.country)) byCountry.set(q.territory.country, q);
                const fallback = webQueries[0]!;
                for (const result of results) {
                    const query = pickQueryForResult(result, webQueries) ?? fallback;
                    mentions.push(mentionFromWebResult(result, query));
                }
                sources.push({
                    source: "web",
                    queries: webQueries.length,
                    results: results.length,
                    status: results.length > 0 ? "ok" : "degraded",
                    detail: results.length > 0 ? undefined : "zero results",
                });
            } catch (error) {
                sources.push({
                    source: "web",
                    queries: webQueries.length,
                    results: 0,
                    status: "failed",
                    detail: error instanceof Error ? error.message : String(error),
                });
            }
        })()
    );

    // ── lookalikes ──
    tasks.push(
        (async () => {
            const seeds = (ports.lookalikes?.seeds ?? []).slice(0, MAX_LOOKALIKE_SEEDS);
            if (!ports.searchCompanies || !ports.describeCompanies) {
                sources.push({
                    source: "lookalike",
                    queries: 0,
                    results: 0,
                    status: "skipped",
                    detail: "needs EXA_API_KEY",
                });
                return;
            }
            if (!ports.lookalikes || seeds.length === 0) {
                sources.push({
                    source: "lookalike",
                    queries: 0,
                    results: 0,
                    status: "skipped",
                    detail: "no customers yet",
                });
                return;
            }
            const found = await gatherLookalikes(
                { ...ports.lookalikes, seeds },
                ports.searchCompanies,
                ports.describeCompanies,
                excluded,
                ports.signal
            );
            mentions.push(...found.mentions);
            sources.push(found.source);
        })()
    );

    // ── places ──
    tasks.push(
        (async () => {
            if (placeQueries.length === 0) {
                sources.push({
                    source: "place",
                    queries: 0,
                    results: 0,
                    status: "skipped",
                    detail: "no place queries planned",
                });
                return;
            }
            if (!ports.searchPlaces) {
                sources.push({
                    source: "place",
                    queries: placeQueries.length,
                    results: 0,
                    status: "skipped",
                    detail: "place search not configured",
                });
                return;
            }
            let total = 0;
            let failures = 0;
            for (const query of placeQueries) {
                if (ports.signal?.aborted) break;
                try {
                    const places = await ports.searchPlaces(query);
                    total += places.length;
                    for (const place of places) {
                        mentions.push({
                            name: place.name,
                            url: place.website ?? null,
                            country: query.territory.country,
                            region: query.territory.region ?? null,
                            city: query.territory.region ?? null,
                            roles: place.roles?.length ? place.roles : [query.partnerKind],
                            categories: place.categories.map(c => c.name),
                            description: place.formattedAddress,
                            source: `place:${place.fsqId}`,
                        });
                    }
                } catch (error) {
                    failures += 1;
                    console.warn("[distribution] place query failed:", query.query, error);
                }
            }
            const status =
                failures === placeQueries.length
                    ? "failed"
                    : failures > 0 || total === 0
                      ? "degraded"
                      : "ok";
            sources.push({
                source: "place",
                queries: placeQueries.length,
                results: total,
                status,
                detail: failures > 0 ? `${failures} queries failed` : undefined,
            });
        })()
    );

    // ── trade ──
    tasks.push(
        (async () => {
            if (!ports.tradeData) {
                sources.push({
                    source: "trade",
                    queries: tradeQueries.length,
                    results: 0,
                    status: "skipped",
                    detail: "trade data not configured",
                });
                return;
            }
            const territories = new Map<string, Territory>();
            for (const q of tradeQueries.length > 0 ? tradeQueries : plan)
                territories.set(q.territory.country, q.territory);
            let total = 0;
            let failures = 0;
            for (const [country, territory] of territories) {
                if (ports.signal?.aborted) break;
                const keywords = tradeQueries
                    .filter(q => q.territory.country === country)
                    .map(q => q.query);
                try {
                    const records = await ports.tradeData.searchShipments(
                        {
                            country,
                            role: "importer",
                            hsCodes: ports.hsCodes,
                            keywords: ports.hsCodes.length > 0 ? undefined : keywords,
                            limit: 200,
                        },
                        { signal: ports.signal }
                    );
                    total += records.length;
                    for (const record of records) {
                        mentions.push({
                            name: record.consignee,
                            country: record.consigneeCountry ?? territory.country,
                            roles: ["importer"],
                            categories: record.description ? [record.description.slice(0, 80)] : [],
                            description: `Imports from ${record.shipper}${record.shipperCountry ? ` (${record.shipperCountry})` : ""}${record.hsCode ? `, HS ${record.hsCode}` : ""}`,
                            source: `trade:${record.source}`,
                            url: record.sourceUrl ?? null,
                        });
                    }
                } catch (error) {
                    failures += 1;
                    console.warn("[distribution] trade query failed:", country, error);
                }
            }
            const status =
                territories.size > 0 && failures === territories.size
                    ? "failed"
                    : failures > 0 || total === 0
                      ? "degraded"
                      : "ok";
            sources.push({
                source: "trade",
                queries: territories.size,
                results: total,
                status,
                detail: failures > 0 ? `${failures} territories failed` : undefined,
            });
        })()
    );

    await Promise.allSettled(tasks);
    sources.sort((a, b) => a.source.localeCompare(b.source));
    return { mentions, sources, webResults };
}

/** The domains company search must leave out, and a check for a hit's URL. */
interface ExcludedDomains {
    list: string[];
    has: (url: string) => boolean;
}

function excludedDomainsOf(domains: readonly string[]): ExcludedDomains {
    const set = new Set(
        domains.map(d => normalizeDomain(d)).filter((d): d is string => Boolean(d))
    );
    return {
        list: [...set],
        has: url => {
            const domain = normalizeDomain(url);
            return domain !== null && set.has(domain);
        },
    };
}

/** Every planned web query through the company index, exclusions honoured. */
async function gatherCompanies(
    queries: PlannedSourceQuery[],
    searchCompanies: SearchCompaniesPort,
    excluded: ExcludedDomains,
    signal: AbortSignal | undefined
): Promise<{ mentions: OrgMention[]; webResults: RawSearchResult[]; source: SourceCount }> {
    const found: OrgMention[] = [];
    const pages: RawSearchResult[] = [];
    const settled = await settleInBatches(
        queries,
        COMPANY_SEARCH_CONCURRENCY,
        query =>
            searchCompanies(query.query, {
                country: query.territory.country,
                excludeDomains: excluded.list,
                signal,
            }),
        signal
    );
    let failures = 0;
    let firstError: string | null = null;
    for (const [i, result] of settled.entries()) {
        const query = queries[i]!;
        if (result.status === "rejected") {
            failures += 1;
            firstError ??= errorText(result.reason);
            console.warn("[distribution] company query failed:", query.query, result.reason);
            continue;
        }
        for (const hit of result.value) {
            if (excluded.has(hit.url)) continue;
            found.push(
                mentionFromCompanyHit(
                    hit,
                    {
                        country: query.territory.country,
                        region: query.territory.region ?? null,
                        partnerKind: query.partnerKind,
                    },
                    `web:company:${query.label}`
                )
            );
            pages.push({
                url: hit.url,
                title: hit.title,
                content: hit.description,
                score: 1,
            });
        }
    }
    const status =
        failures === queries.length
            ? "failed"
            : failures > 0 || found.length === 0
              ? "degraded"
              : "ok";
    return {
        mentions: found,
        webResults: pages,
        source: {
            source: "web",
            queries: queries.length,
            results: found.length,
            status,
            detail:
                status === "failed"
                    ? (firstError ?? undefined)
                    : failures > 0
                      ? `${failures} queries failed`
                      : found.length === 0
                        ? "zero results"
                        : undefined,
        },
    };
}

/** Companies like each seed: its description, then one company search. */
async function gatherLookalikes(
    input: LookalikeInput,
    searchCompanies: SearchCompaniesPort,
    describeCompanies: DescribeCompaniesPort,
    excluded: ExcludedDomains,
    signal: AbortSignal | undefined
): Promise<{ mentions: OrgMention[]; source: SourceCount }> {
    // A seed Exa cannot read is still searched for by its domain.
    const descriptions = new Map<string, CompanyDescription>();
    try {
        const described = await describeCompanies(
            input.seeds.map(domain => `https://${domain}/`),
            signal
        );
        for (const d of described) {
            const domain = normalizeDomain(d.url);
            if (domain && !descriptions.has(domain)) descriptions.set(domain, d);
        }
    } catch (error) {
        console.warn("[distribution] describing lookalike seeds failed:", error);
    }
    const settled = await settleInBatches(
        input.seeds,
        COMPANY_SEARCH_CONCURRENCY,
        seed => {
            const described = descriptions.get(seed);
            const name = described ? companyName(described.title, seed) : seed;
            return searchCompanies(lookalikeQuery(name, described?.description ?? null), {
                country: input.country ?? undefined,
                excludeDomains: excluded.list,
                signal,
            });
        },
        signal
    );
    const found: OrgMention[] = [];
    let failures = 0;
    let firstError: string | null = null;
    for (const [i, result] of settled.entries()) {
        const seed = input.seeds[i]!;
        if (result.status === "rejected") {
            failures += 1;
            firstError ??= errorText(result.reason);
            console.warn("[distribution] lookalike search failed:", seed, result.reason);
            continue;
        }
        for (const hit of result.value) {
            if (excluded.has(hit.url)) continue;
            found.push(
                mentionFromCompanyHit(
                    hit,
                    { country: input.country, partnerKind: input.partnerKind },
                    `lookalike:${seed}`
                )
            );
        }
    }
    const searched = input.seeds.length - failures;
    const status =
        failures === input.seeds.length
            ? "failed"
            : failures > 0 || found.length === 0
              ? "degraded"
              : "ok";
    return {
        mentions: found,
        source: {
            source: "lookalike",
            queries: input.seeds.length,
            results: found.length,
            status,
            detail:
                status === "failed"
                    ? (firstError ?? undefined)
                    : failures > 0
                      ? `${failures} of ${input.seeds.length} customers failed`
                      : found.length === 0
                        ? "zero results"
                        : searched === 1
                          ? "from 1 customer"
                          : `from ${searched} customers`,
        },
    };
}

function pickQueryForResult(
    result: RawSearchResult,
    queries: PlannedSourceQuery[]
): PlannedSourceQuery | null {
    const text = `${result.title} ${result.content}`.toLowerCase();
    let best: PlannedSourceQuery | null = null;
    let bestScore = 0;
    for (const query of queries) {
        const terms = query.query
            .toLowerCase()
            .split(/\s+/)
            .filter(t => t.length > 3);
        const score = terms.filter(t => text.includes(t)).length;
        if (score > bestScore) {
            best = query;
            bestScore = score;
        }
    }
    return best;
}
