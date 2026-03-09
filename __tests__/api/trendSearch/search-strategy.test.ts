/**
 * Unit tests for executeSearch strategy logic.
 * Feature: Serper dual-channel search — Task 4.2
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.3, 6.1, 6.2
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

import { env } from "~/env";
import { executeSearch } from "~/lib/tools/trend-search/web-search";
import type { PlannedQuery } from "~/lib/tools/trend-search/types";

const subQueries: PlannedQuery[] = [
    { searchQuery: "test query", category: "tech", rationale: "test" },
];

function tavilyResponse(results: { url: string; title?: string; content?: string; score?: number }[]) {
    return {
        ok: true,
        text: async () => "",
        json: async () => ({ results }),
    } as Response;
}

function serperResponse(items: { link: string; title?: string; snippet?: string; score?: number }[]) {
    return {
        ok: true,
        text: async () => "",
        json: async () => ({
            news: items.map((item) => ({
                link: item.link,
                title: item.title ?? "Untitled",
                snippet: item.snippet ?? "",
                position: 1,
            })),
        }),
    } as Response;
}

function getFetchCallsByUrl(fetchSpy: jest.SpyInstance): { tavily: number; serper: number } {
    const calls = fetchSpy.mock.calls as [string, unknown][];
    let tavily = 0;
    let serper = 0;
    for (const [url] of calls) {
        if (url === TAVILY_URL) tavily++;
        if (url === SERPER_URL) serper++;
    }
    return { tavily, serper };
}

describe("executeSearch strategy logic", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        env.server.TAVILY_API_KEY = "test-tavily-key";
        env.server.SERPER_API_KEY = "test-serper-key";
        env.server.SEARCH_PROVIDER = undefined;
        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
            if (url === TAVILY_URL) {
                return Promise.resolve(tavilyResponse([{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }]));
            }
            if (url === SERPER_URL) {
                return Promise.resolve(serperResponse([{ link: "https://serper.com/1", title: "S", snippet: "Snippet" }]));
            }
            return Promise.reject(new Error(`Unexpected URL: ${url}`));
        });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    describe("default strategy (no env) uses Tavily only", () => {
        it("when SEARCH_PROVIDER is unset, only Tavily is called and providerUsed is tavily", async () => {
            env.server.SEARCH_PROVIDER = undefined;
            env.server.SERPER_API_KEY = "test-serper-key";

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("tavily");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(tavily).toBe(1);
            expect(serper).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://tavily.com/1");
        });
    });

    describe('"serper" strategy uses Serper only', () => {
        it("when strategy is serper, only Serper is called and providerUsed is serper", async () => {
            env.server.SEARCH_PROVIDER = "serper";

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(tavily).toBe(0);
            expect(serper).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://serper.com/1");
        });
    });

    describe('"fallback" strategy tries Serper first, falls back to Tavily on total failure', () => {
        it("when Serper returns no results for all sub-queries, Tavily is called and providerUsed is tavily (fallback)", async () => {
            env.server.SEARCH_PROVIDER = "fallback";
            let callCount = 0;
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                callCount++;
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([])); // empty
                }
                if (url === TAVILY_URL) {
                    return Promise.resolve(tavilyResponse([{ url: "https://tavily.com/fallback", title: "T", content: "C", score: 0.8 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("tavily (fallback)");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(tavily).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://tavily.com/fallback");
        });
    });

    describe('"fallback" strategy does NOT fall back when Serper returns results', () => {
        it("when Serper returns results, Tavily is not called and providerUsed is serper", async () => {
            env.server.SEARCH_PROVIDER = "fallback";
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([{ link: "https://serper.com/ok", title: "S", snippet: "S" }]));
                }
                if (url === TAVILY_URL) {
                    return Promise.resolve(tavilyResponse([{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(tavily).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://serper.com/ok");
        });
    });

    describe('"parallel" strategy calls both providers and merges results', () => {
        it("when strategy is parallel, both Serper and Tavily are called and providerUsed is tavily+serper", async () => {
            env.server.SEARCH_PROVIDER = "parallel";
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([{ link: "https://serper.com/1", title: "S", snippet: "S" }]));
                }
                if (url === TAVILY_URL) {
                    return Promise.resolve(tavilyResponse([{ url: "https://tavily.com/1", title: "T", content: "C", score: 0.9 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("tavily+serper");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(tavily).toBe(1);
            expect(results).toHaveLength(2);
            const urls = results.map((r) => r.url).sort();
            expect(urls).toEqual(["https://serper.com/1", "https://tavily.com/1"]);
        });
    });

    describe('"parallel" strategy deduplicates by URL, keeping higher score', () => {
        it("when both providers return the same URL, result has the higher score", async () => {
            env.server.SEARCH_PROVIDER = "parallel";
            const sameUrl = "https://example.com/same";
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(
                        serperResponse([{ link: sameUrl, title: "From Serper", snippet: "S" }])
                    );
                }
                if (url === TAVILY_URL) {
                    return Promise.resolve(
                        tavilyResponse([{ url: sameUrl, title: "From Tavily", content: "C", score: 0.95 }])
                    );
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("tavily+serper");
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe(sameUrl);
            expect(results[0]!.score).toBe(0.95);
            expect(results[0]!.title).toBe("From Tavily");
        });
    });

    describe('missing Serper key with "serper" strategy downgrades to "tavily"', () => {
        it("when SEARCH_PROVIDER is serper but SERPER_API_KEY is unset, only Tavily is called and providerUsed is tavily", async () => {
            env.server.SEARCH_PROVIDER = "serper";
            env.server.SERPER_API_KEY = undefined as unknown as string;
            const warnSpy = jest.spyOn(console, "warn").mockImplementation();

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("tavily");
            const { tavily, serper } = getFetchCallsByUrl(fetchSpy);
            expect(tavily).toBe(1);
            expect(serper).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://tavily.com/1");
            expect(warnSpy).toHaveBeenCalledWith(
                "[web-search] SERPER_API_KEY not set; downgrading strategy to tavily."
            );
            warnSpy.mockRestore();
        });
    });
});
