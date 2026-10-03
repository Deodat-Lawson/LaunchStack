"use client";

import { useProspects } from "../prospects/_lib/context";

/**
 * Where Growth's pages live and how their state is spelled in the URL.
 *
 * Each area is one page. What used to be a route (companies, a company,
 * people, deals, runs, the segment, compose, the calendar week, accounts) is
 * a query parameter on that page, so a link still opens the right thing and
 * the back button still leaves the tool rather than walking through tabs.
 * The Prospects provider carries the base path so the same pages mount in
 * the preview harness under /dev.
 */
export interface GrowthUrls {
    app: string;
    brand: (query?: Record<string, string | null | undefined>) => string;
    campaigns: string;
    prospects: (query?: Record<string, string | null | undefined>) => string;
}

export function withQuery(path: string, query?: Record<string, string | null | undefined>): string {
    if (!query) return path;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
    const s = search.toString();
    return s ? `${path}?${s}` : path;
}

export function useGrowthUrls(): GrowthUrls {
    const { href } = useProspects();
    const prospectsBase = href("");
    const app = prospectsBase.replace(/\/prospects$/, "");
    return {
        app,
        brand: query => withQuery(`${app}/brand`, query),
        campaigns: `${app}/brand/campaigns`,
        prospects: query => withQuery(prospectsBase, query),
    };
}
