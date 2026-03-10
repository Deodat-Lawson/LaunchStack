/**
 * Property-based and unit tests for Web Search Executor (executeSearch).
 * Feature: ai-trend-search-engine — Task 4.4
 * Property 6: Every sub-query triggers a search call.
 * Unit: edge cases 3.3 (zero results), 3.4 (retries then fail).
 */

jest.mock("~/env", () => ({
    env: {
        server: {
            TAVILY_API_KEY: "test-tavily-key",
        },
    },
}));

import * as fc from "fast-check";
import { executeSearch } from "~/server/trend-search/web-search";
import type { PlannedQuery, SearchCategory } from "~/server/trend-search/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = ["fashion", "finance", "business", "tech"] as const satisfies readonly SearchCategory[];

const categoryArb = fc.constantFrom(...validCategories);

function plannedQueryArb(categoryArbitrary: fc.Arbitrary<SearchCategory>) {
    return fc.record({
        searchQuery: fc.string({ minLength: 1, maxLength: 500 }),
        category: categoryArbitrary,
        rationale: fc.string({ minLength: 1, maxLength: 300 }),
    });
}

/** Generates random PlannedQuery arrays (1–5 items for property test). */
const plannedQueriesArb = fc.array(plannedQueryArb(categoryArb), {
    minLength: 1,
    maxLength: 5,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTavilyOkResponse(results: { url: string; title?: string; content?: string; score?: number }[]) {
    return {
        ok: true,
        text: async () => "",
        json: async () => ({ results }),
    } as Response;
}

// ─── Property 6: Every sub-query triggers a search call ───────────────────────

describe("Property 6: Every sub-query triggers a search call", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
            makeTavilyOkResponse([{ url: "https://example.com/1", title: "T", content: "C", score: 0.9 }])
        );
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it("mock Tavily called once per sub-query for any random PlannedQuery array", async () => {
        await fc.assert(
            fc.asyncProperty(plannedQueriesArb, async (subQueries) => {
                fetchSpy.mockClear();
                fetchSpy.mockResolvedValue(
                    makeTavilyOkResponse([{ url: "https://example.com/1", title: "T", content: "C", score: 0.9 }])
                );

                await executeSearch(subQueries);

                expect(fetchSpy).toHaveBeenCalledTimes(subQueries.length);
            }),
            { numRuns: 50 }
        );
    });
});

// ─── Unit test: One sub-query returns 0 results, pipeline continues (edge 3.3) ─

describe("Unit: one sub-query returns 0 results, pipeline continues", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it("when one sub-query returns 0 results, pipeline continues and returns results from others", async () => {
        const subQueries: PlannedQuery[] = [
            { searchQuery: "q1", category: "tech", rationale: "r1" },
            { searchQuery: "q2", category: "business", rationale: "r2" },
            { searchQuery: "q3", category: "finance", rationale: "r3" },
        ];

        let callCount = 0;
        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
            callCount++;
            // First sub-query: zero results; second and third: one result each
            if (callCount === 1) {
                return Promise.resolve(makeTavilyOkResponse([]));
            }
            if (callCount === 2) {
                return Promise.resolve(
                    makeTavilyOkResponse([{ url: "https://b.com", title: "B", content: "C2", score: 0.8 }])
                );
            }
            return Promise.resolve(
                makeTavilyOkResponse([{ url: "https://c.com", title: "C", content: "C3", score: 0.7 }])
            );
        });

        const result = await executeSearch(subQueries);

        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(result).toHaveLength(2);
        expect(result.map((r) => r.url)).toEqual(["https://b.com", "https://c.com"]);
    });
});

// ─── Unit test: Tavily fails, retries 2 times then sub-query failed (edge 3.4) ──

describe("Unit: Tavily fails, retries 2 times then marks sub-query failed", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it("when Tavily fails 3 times for one sub-query, that sub-query is skipped and others still run", async () => {
        const subQueries: PlannedQuery[] = [
            { searchQuery: "failing-query", category: "tech", rationale: "r1" },
            { searchQuery: "ok-query", category: "business", rationale: "r2" },
        ];

        let callCount = 0;
        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
            callCount++;
            // First 3 calls: same sub-query (1 initial + 2 retries) — all fail
            if (callCount <= 3) {
                return Promise.reject(new Error("Tavily API error: 500"));
            }
            // 4th call: second sub-query succeeds
            return Promise.resolve(
                makeTavilyOkResponse([{ url: "https://ok.com", title: "OK", content: "Content", score: 0.9 }])
            );
        });

        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

        const result = await executeSearch(subQueries);

        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();

        // 1 + 2 retries for first sub-query, then 1 for second
        expect(fetchSpy).toHaveBeenCalledTimes(4);
        expect(result).toHaveLength(1);
        expect(result[0].url).toBe("https://ok.com");
    });
});
