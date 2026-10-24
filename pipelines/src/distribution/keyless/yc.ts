/**
 * The Y Combinator company directory, as published daily by the yc-oss
 * project as static JSON. No key. One download per process per day, then
 * filtered in memory by country and by the words in the segment.
 */
import type { RawSearchResult } from "@launchstack/tools/web-research";

import { mentionsPlace, placeWords } from "../locate";
import { countryAliases } from "./geo";
import { KEYLESS_USER_AGENT } from "./osm";

export const YC_ALL_URL = "https://yc-oss.github.io/api/companies/all.json";

export interface YcCompany {
    id: number;
    name: string;
    slug: string;
    website: string | null;
    all_locations: string;
    one_liner: string;
    long_description?: string;
    industries: string[];
    industry?: string;
    subindustry?: string;
    tags?: string[];
    status: string;
    team_size?: number | null;
    batch?: string;
}

const CACHE_MS = 24 * 3600_000;
let cache: { at: number; companies: YcCompany[] } | null = null;

export function resetYcCache(): void {
    cache = null;
}

async function loadAll(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<YcCompany[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.companies;
    const response = await fetchImpl(YC_ALL_URL, {
        headers: { "User-Agent": KEYLESS_USER_AGENT, Accept: "application/json" },
        signal,
    });
    if (!response.ok) throw new Error(`YC directory ${response.status}`);
    const companies = (await response.json()) as YcCompany[];
    cache = { at: Date.now(), companies };
    return companies;
}

export function significantWords(keywords: readonly string[]): string[] {
    return [
        ...new Set(
            keywords
                .flatMap(k => k.toLowerCase().split(/[^\p{L}\p{N}]+/u))
                .filter(w => w.length >= 4)
        ),
    ];
}

/**
 * Whether a YC `all_locations` string ("San Francisco, CA, USA; Remote") puts
 * the company in the country — and, when one is asked for, the region or
 * city. Whole words only: the old substring test let the US alias "us"
 * match Houston, Brussels and Russia.
 */
export function ycInTerritory(
    allLocations: string,
    country: string,
    region?: string | null
): boolean {
    const places = allLocations
        .split(/[;|]/)
        .map(p => p.trim())
        .filter(Boolean);
    const aliases = countryAliases(country);
    return places.some(place => {
        const inCountry = aliases.some(a =>
            a.length > 2
                ? mentionsPlace(place, a)
                : new RegExp(`\\b${a.toUpperCase()}\\b`).test(place)
        );
        return inCountry && (!region || mentionsPlace(place, region));
    });
}

/**
 * Pure filter, exported for tests: active companies in the territory whose
 * blurb mentions a topic word. Place words never count as topic words — a
 * query for "coffee Baltimore, United States" used to match every company
 * whose description said "United States".
 */
export function filterYc(
    companies: readonly YcCompany[],
    args: { country: string; region?: string | null; keywords: readonly string[]; limit?: number }
): YcCompany[] {
    const places = placeWords({ country: args.country, region: args.region ?? undefined });
    const words = significantWords(args.keywords).filter(w => !places.has(w));
    // Nothing to match on means nothing relevant to return, not everything.
    if (words.length === 0) return [];
    const matches: Array<{ c: YcCompany; score: number }> = [];
    for (const c of companies) {
        if (c.status && c.status !== "Active") continue;
        if (!ycInTerritory(c.all_locations ?? "", args.country, args.region)) continue;
        const hay = [
            c.one_liner,
            c.industry,
            c.subindustry,
            ...(c.industries ?? []),
            ...(c.tags ?? []),
            c.long_description ?? "",
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        const score = words.reduce((n, w) => n + (mentionsPlace(hay, w) ? 1 : 0), 0);
        if (score > 0) matches.push({ c, score });
    }
    return matches
        .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
        .slice(0, args.limit ?? 40)
        .map(m => m.c);
}

/** A directory entry as a search result; its location is the entry's own, not the query's. */
export function ycToResult(c: YcCompany): RawSearchResult {
    const site = c.website?.trim();
    return {
        url: site?.length ? site : `https://www.ycombinator.com/companies/${c.slug}`,
        title: `${c.name} | ${c.industries?.slice(0, 2).join(", ") || "startup"}`,
        content:
            `${c.one_liner ?? ""} ${c.industries?.join(", ") ?? ""} Located in ${c.all_locations ?? "unknown"}. ${c.batch ?? ""}`.trim(),
        score: 0.8,
    };
}

export async function searchYc(
    args: { country: string; region?: string | null; keywords: readonly string[]; limit?: number },
    options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<RawSearchResult[]> {
    const all = await loadAll(options.fetchImpl ?? fetch, options.signal);
    return filterYc(all, args).map(ycToResult);
}
