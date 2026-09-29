/**
 * The Y Combinator company directory, as published daily by the yc-oss
 * project as static JSON. No key. One download per process per day, then
 * filtered in memory by country and by the words in the segment.
 */
import type { RawSearchResult } from "@launchstack/tools/web-research";

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

/** Pure filter, exported for tests: active companies in the country whose blurb mentions a keyword. */
export function filterYc(
    companies: readonly YcCompany[],
    args: { country: string; keywords: readonly string[]; limit?: number }
): YcCompany[] {
    const aliases = countryAliases(args.country);
    const words = significantWords(args.keywords);
    const matches: Array<{ c: YcCompany; score: number }> = [];
    for (const c of companies) {
        if (c.status && c.status !== "Active") continue;
        const loc = (c.all_locations ?? "").toLowerCase();
        if (!aliases.some(a => loc.includes(a))) continue;
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
        const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        if (words.length === 0 || score > 0) matches.push({ c, score });
    }
    return matches
        .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
        .slice(0, args.limit ?? 40)
        .map(m => m.c);
}

export function ycToResult(c: YcCompany, country: string): RawSearchResult {
    const site = c.website?.trim();
    return {
        url: site?.length ? site : `https://www.ycombinator.com/companies/${c.slug}`,
        title: `${c.name} | ${c.industries?.slice(0, 2).join(", ") || "startup"}`,
        content:
            `${c.one_liner ?? ""} ${c.industries?.join(", ") ?? ""} ${c.all_locations ?? ""} ${c.batch ?? ""} country:${country}`.trim(),
        score: 0.8,
    };
}

export async function searchYc(
    args: { country: string; keywords: readonly string[]; limit?: number },
    options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<RawSearchResult[]> {
    const all = await loadAll(options.fetchImpl ?? fetch, options.signal);
    return filterYc(all, args).map(c => ycToResult(c, args.country.toUpperCase()));
}
