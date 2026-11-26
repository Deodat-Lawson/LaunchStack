/**
 * Trend research searches for the network by the name a search engine knows:
 * "Hacker News marketing trends", never "hackernews marketing trends". The
 * original four search by their id, as they always have.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@launchstack/pipelines/trend-search", () => ({ runTrendSearch: vi.fn() }));
vi.mock("@launchstack/pipelines/trend-search/cache", () => ({
    getCachedTrendSearch: vi.fn(() => null),
    setCachedTrendSearch: vi.fn(),
}));

import { runTrendSearch } from "@launchstack/pipelines/trend-search";

import { researchPlatformTrends } from "./research";
import type { CampaignPlatform } from "./types";

const mockSearch = vi.mocked(runTrendSearch);

async function queriesFor(platform: CampaignPlatform): Promise<string[]> {
    await researchPlatformTrends({
        platform,
        prompt: "claim checking",
        companyName: "Acme",
        companyContext: "Acme makes campaign tools.",
        maxResults: 3,
    });
    const [, options] = mockSearch.mock.calls.at(-1)!;
    return (options?.preBuiltQueries ?? []).map(q => q.searchQuery);
}

beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({
        results: [{ summary: "A trend", description: "About it", sourceUrl: "https://t.example" }],
    } as never);
});

describe("trend queries", () => {
    it("search a draft-only network by its real name", async () => {
        const hn = await queriesFor("hackernews");
        expect(hn).toHaveLength(3);
        for (const query of hn) expect(query).toContain("Hacker News");
        expect(hn.join(" ")).not.toContain("hackernews");

        const ph = await queriesFor("producthunt");
        expect(ph[0]).toMatch(/^Product Hunt marketing trends \d{4}/);
    });

    it("search the original four by id, as before", async () => {
        const x = await queriesFor("x");
        expect(x[0]).toMatch(/^x marketing trends \d{4}/);
        expect(x[2]).toMatch(/^x engagement strategies/);
    });

    it("labels each result with the network it was researched for", async () => {
        const results = await researchPlatformTrends({
            platform: "mastodon",
            prompt: "claim checking",
            companyName: "Acme",
            companyContext: "Acme makes campaign tools.",
            maxResults: 3,
        });
        expect(results).toEqual([
            { title: "A trend", url: "https://t.example", snippet: "About it", source: "mastodon" },
        ]);
    });
});
