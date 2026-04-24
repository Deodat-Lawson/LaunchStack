/**
 * Property-based and unit tests for Web Search Executor (executeSearch).
 * Feature: ai-trend-search-engine — Task 4.4
 * Property 6: Every sub-query triggers a search call.
 * Unit: edge cases 3.3 (zero results), 3.4 (retries then fail).
 */

import * as fc from "fast-check";
import { executeSearch } from "@launchstack/features/trend-search/web-search";
import type { PlannedQuery, SearchCategory } from "@launchstack/features/trend-search";

// Providers read API keys from process.env directly, so manipulate process.env
// (not a mocked ~/env module) in these tests.
const ORIGINAL_ENV = {
    EXA_API_KEY: process.env.EXA_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
};

beforeEach(() => {
    process.env.EXA_API_KEY = "test-exa-key";
    delete process.env.SERPER_API_KEY;
    delete process.env.SEARCH_PROVIDER;
});

afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

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

function makeExaOkResponse(results: { url: string; title?: string; text?: string; score?: number }[]) {
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
            makeExaOkResponse([{ url: "https://example.com/1", title: "T", text: "C", score: 0.9 }])
        );
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it("mock Exa called once per sub-query for any random PlannedQuery array", async () => {
        await fc.assert(
            fc.asyncProperty(plannedQueriesArb, async (subQueries) => {
                fetchSpy.mockClear();
                fetchSpy.mockResolvedValue(
                    makeExaOkResponse([{ url: "https://example.com/1", title: "T", text: "C", score: 0.9 }])
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
                return Promise.resolve(makeExaOkResponse([]));
            }
            if (callCount === 2) {
                return Promise.resolve(
                    makeExaOkResponse([{ url: "https://b.com", title: "B", text: "C2", score: 0.8 }])
                );
            }
            return Promise.resolve(
                makeExaOkResponse([{ url: "https://c.com", title: "C", text: "C3", score: 0.7 }])
            );
        });

        const { results } = await executeSearch(subQueries);

        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(results).toHaveLength(2);
        expect(results.map((r) => r.url)).toEqual(["https://b.com", "https://c.com"]);
    });
});

// ─── Unit test: Exa fails, retries 2 times then sub-query failed (edge 3.4) ──

describe("Unit: Exa fails, retries 2 times then marks sub-query failed", () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it("when Exa fails 3 times for one sub-query, that sub-query is skipped and others still run", async () => {
        const subQueries: PlannedQuery[] = [
            { searchQuery: "failing-query", category: "tech", rationale: "r1" },
            { searchQuery: "ok-query", category: "business", rationale: "r2" },
        ];

        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
            if (body.query === "failing-query") {
                return Promise.reject(new Error("Exa API error: 500"));
            }
            return Promise.resolve(
                makeExaOkResponse([{ url: "https://ok.com", title: "OK", text: "Content", score: 0.9 }])
            );
        });

        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

        const { results } = await executeSearch(subQueries);

        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();

        // 3 attempts (initial + 2 retries) for failing query, 1 attempt for ok-query
        expect(fetchSpy).toHaveBeenCalledTimes(4);
        expect(results).toHaveLength(1);
        expect(results[0]!.url).toBe("https://ok.com");
    });
});
