/**
 * Property-based tests for search provider normalization and strategy behavior.
 * Feature: Serper dual-channel search — Task 4.3
 * Property 13: Serper adapter output conforms to RawSearchResult.
 * Property 14: Fallback strategy invokes secondary when primary returns empty.
 * Property 15: Parallel merge deduplicates by URL (Serper first, then Tavily).
 * Property 16: Default (no env) matches Tavily-only behavior.
 * Property 17: Serper-dependent strategies downgrade when key missing.
 */

const TAVILY_URL = "https://api.tavily.com/search";
const SERPER_URL = "https://google.serper.dev/news";

jest.mock("~/env", () => {
    const server = {
        TAVILY_API_KEY: "test-tavily-key",
        SERPER_API_KEY: "test-serper-key",
        SEARCH_PROVIDER: undefined as "tavily" | "serper" | "fallback" | "parallel" | undefined,
    };
    return { env: { server } };
});

import * as fc from "fast-check";
import { env } from "~/env";
import { callSerper } from "@launchstack/features/trend-search/providers/serper";
import { executeSearch } from "@launchstack/features/trend-search/web-search";
import type { PlannedQuery, RawSearchResult } from "@launchstack/features/trend-search";
import type { ProviderStrategy } from "@launchstack/features/trend-search/providers/types";

beforeEach(() => {
    env.server.TAVILY_API_KEY = "test-tavily-key";
    env.server.SERPER_API_KEY = "test-serper-key";
    env.server.SEARCH_PROVIDER = undefined;
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = ["fashion", "finance", "business", "tech"] as const;

const categoryArb = fc.constantFrom(...validCategories);

const plannedQueryArb: fc.Arbitrary<PlannedQuery> = fc.record({
    searchQuery: fc.string({ minLength: 1, maxLength: 300 }),
    category: categoryArb,
    rationale: fc.string({ minLength: 1, maxLength: 200 }),
});

const subQueriesArb = fc.array(plannedQueryArb, { minLength: 1, maxLength: 5 });

/** Serper news item shape (subset we use). */
const serperNewsItemArb = fc.record({
    link: fc.webUrl({ validSchemes: ["https"] }),
    title: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
    snippet: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
    date: fc.option(fc.string(), { nil: undefined }),
    position: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
});

const serperNewsArrayArb = fc.array(serperNewsItemArb, { minLength: 0, maxLength: 15 });

/** RawSearchResult arbitrary for merge tests. */
const rawSearchResultArb = fc.record({
    url: fc.webUrl({ validSchemes: ["https"] }),
    title: fc.string({ minLength: 1, maxLength: 200 }),
    content: fc.string({ maxLength: 500 }),
    score: fc.double({ min: 0, max: 1 }),
    publishedDate: fc.option(fc.string(), { nil: undefined }),
});

function normalizeUrl(url: string): string {
    try {
        return new URL(url).href;
    } catch {
        return url.trim();
    }
}

function conformsToRawSearchResult(r: unknown): r is RawSearchResult {
    if (r === null || typeof r !== "object") return false;
    const o = r as Record<string, unknown>;
    return (
        typeof o.url === "string" &&
        o.url.length > 0 &&
        typeof o.title === "string" &&
        typeof o.content === "string" &&
        typeof o.score === "number" &&
        (!("publishedDate" in o) || typeof o.publishedDate === "string" || o.publishedDate === undefined)
    );
}

// ─── Property 13: Serper output conforms to RawSearchResult ───────────────────

describe("Property 13: Serper-shaped responses normalize to RawSearchResult", () => {
    it("for any random Serper news array, every output item conforms to RawSearchResult", async () => {
        await fc.assert(
            fc.asyncProperty(serperNewsArrayArb, async (news) => {
                const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
                    ok: true,
                    text: async () => "",
                    json: async () => ({ news }),
                } as Response);

                const results = await callSerper("test query");

                fetchSpy.mockRestore();

                for (const item of results) {
                    expect(conformsToRawSearchResult(item)).toBe(true);
                    expect(item.url).toBeDefined();
                    expect(typeof item.title).toBe("string");
                    expect(typeof item.content).toBe("string");
                    expect(typeof item.score).toBe("number");
                }
            }),
            { numRuns: 80 }
        );
    });
});

// ─── Property 14: Fallback invokes secondary when primary returns empty ─────────

describe("Property 14: Fallback strategy invokes secondary when primary returns empty", () => {
    it("for random sub-query lists, when primary (Serper) returns empty, Tavily is invoked once per sub-query", async () => {
        await fc.assert(
            fc.asyncProperty(subQueriesArb, async (subQueries) => {
                let serperCalls = 0;
                let tavilyCalls = 0;
                const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
                    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                    if (url === SERPER_URL) {
                        serperCalls++;
                        return Promise.resolve({
                            ok: true,
                            text: async () => "",
                            json: async () => ({ news: [] }),
                        } as Response);
                    }
                    if (url === TAVILY_URL) {
                        tavilyCalls++;
                        return Promise.resolve({
                            ok: true,
                            text: async () => "",
                            json: async () => ({
                                results: [{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }],
                            }),
                        } as Response);
                    }
                    return Promise.reject(new Error(`Unexpected URL: ${url}`));
                });

                env.server.SEARCH_PROVIDER = "fallback";
                env.server.SERPER_API_KEY = "test-serper-key";

                await executeSearch(subQueries);

                fetchSpy.mockRestore();

                expect(serperCalls).toBe(subQueries.length);
                expect(tavilyCalls).toBe(subQueries.length);
            }),
            { numRuns: 50 }
        );
    });
});

// ─── Property 15: Parallel dedup — Serper rows first, then Tavily (no cross-provider score compare) ──────────

describe("Property 15: Parallel merge deduplicates by URL (Serper first)", () => {
    it("for two random result sets with overlapping URLs, merged result has no duplicate URLs and Serper wins on URL tie", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(rawSearchResultArb, { minLength: 0, maxLength: 5 }),
                fc.array(rawSearchResultArb, { minLength: 0, maxLength: 5 }),
                fc.string({ minLength: 1, maxLength: 100 }),
                async (setA, setB, _query) => {
                    // Tavily returns setA with original scores; Serper adapter recomputes score as 1 - position/totalResults
                    const serperScores = setB.length > 0
                        ? setB.map((_, i) => 1 - (i + 1) / setB.length)
                        : [];
                    const setBWithSerperScores = setB.map((r, i) => ({ ...r, score: serperScores[i] ?? 0 }));
                    // Replicate executeSearch parallel merge: Serper first, then Tavily; first URL wins
                    const byUrl = new Map<string, RawSearchResult>();
                    for (const r of setBWithSerperScores) {
                        const key = normalizeUrl(r.url);
                        if (!key) continue;
                        if (!byUrl.has(key)) byUrl.set(key, r);
                    }
                    for (const r of setA) {
                        const key = normalizeUrl(r.url);
                        if (!key) continue;
                        if (!byUrl.has(key)) byUrl.set(key, r);
                    }
                    const pairKey = (r: RawSearchResult) => `${normalizeUrl(r.url)}::${Number(r.score).toFixed(10)}`;
                    const expectedPairs = new Set([...byUrl.values()].map(pairKey));

                    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
                        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                        if (url === TAVILY_URL) {
                            return Promise.resolve({
                                ok: true,
                                text: async () => "",
                                json: async () => ({ results: setA }),
                            } as Response);
                        }
                        if (url === SERPER_URL) {
                            const serperNews = setB.map((r, i) => ({
                                link: r.url,
                                title: r.title,
                                snippet: r.content,
                                position: i + 1,
                            }));
                            return Promise.resolve({
                                ok: true,
                                text: async () => "",
                                json: async () => ({ news: serperNews }),
                            } as Response);
                        }
                        return Promise.reject(new Error(`Unexpected URL: ${url}`));
                    });

                    env.server.SEARCH_PROVIDER = "parallel";
                    env.server.SERPER_API_KEY = "test-serper-key";

                    const { results } = await executeSearch(
                        [{ searchQuery: "q", category: "tech", rationale: "r" }],
                        "parallel"
                    );

                    fetchSpy.mockRestore();

                    const resultUrls = results.map((r) => r.url);
                    const uniqueUrls = new Set(resultUrls);
                    expect(resultUrls.length).toBe(uniqueUrls.size);

                    const actualPairs = new Set(results.map(pairKey));
                    expect(actualPairs.size).toBe(expectedPairs.size);
                    for (const p of actualPairs) {
                        expect(expectedPairs.has(p)).toBe(true);
                    }
                }
            ),
            { numRuns: 60 }
        );
    });
});

// ─── Property 16: Default (no env) matches Tavily-only ──────────────────────────

describe("Property 16: Default strategy matches Tavily-only behavior", () => {
    it("when SEARCH_PROVIDER is unset, providerUsed is tavily and only Tavily is called", async () => {
        await fc.assert(
            fc.asyncProperty(subQueriesArb, async (subQueries) => {
                let tavilyCalls = 0;
                let serperCalls = 0;
                const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
                    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                    if (url === TAVILY_URL) {
                        tavilyCalls++;
                        return Promise.resolve({
                            ok: true,
                            text: async () => "",
                            json: async () => ({
                                results: [{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }],
                            }),
                        } as Response);
                    }
                    if (url === SERPER_URL) {
                        serperCalls++;
                        return Promise.resolve({
                            ok: true,
                            text: async () => "",
                            json: async () => ({ news: [] }),
                        } as Response);
                    }
                    return Promise.reject(new Error(`Unexpected URL: ${url}`));
                });

                env.server.SEARCH_PROVIDER = undefined;
                env.server.SERPER_API_KEY = "test-serper-key";

                const { providerUsed } = await executeSearch(subQueries);

                fetchSpy.mockRestore();

                expect(providerUsed).toBe("tavily");
                expect(tavilyCalls).toBe(subQueries.length);
                expect(serperCalls).toBe(0);
            }),
            { numRuns: 50 }
        );
    });
});

// ─── Property 17: Serper-dependent strategies downgrade when key missing ───────

describe("Property 17: Missing Serper key downgrades Serper-dependent strategies to tavily", () => {
    const serperDependentStrategies: ProviderStrategy[] = ["serper", "fallback", "parallel"];

    it("for each Serper-dependent strategy, when SERPER_API_KEY is unset, providerUsed is tavily and no throw", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...serperDependentStrategies),
                subQueriesArb,
                async (strategy, subQueries) => {
                    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
                        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                        if (url === TAVILY_URL) {
                            return Promise.resolve({
                                ok: true,
                                text: async () => "",
                                json: async () => ({
                                    results: [{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }],
                                }),
                            } as Response);
                        }
                        if (url === SERPER_URL) {
                            return Promise.resolve({
                                ok: true,
                                text: async () => "",
                                json: async () => ({ news: [] }),
                            } as Response);
                        }
                        return Promise.reject(new Error(`Unexpected URL: ${url}`));
                    });

                    env.server.SERPER_API_KEY = undefined as unknown as string;
                    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

                    const { providerUsed } = await executeSearch(subQueries, strategy);

                    warnSpy.mockRestore();
                    fetchSpy.mockRestore();

                    expect(providerUsed).toBe("tavily");
                }
            ),
            { numRuns: 30 }
        );
    });
});
