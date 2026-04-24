/**
 * Unit tests for executeSearch strategy logic.
 * Feature: Serper dual-channel search — Task 4.2
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.3, 6.1, 6.2
 */

import { executeSearch } from "@launchstack/features/trend-search/web-search";
import type { PlannedQuery } from "@launchstack/features/trend-search";

const EXA_URL = "https://api.exa.ai/search";
const SERPER_URL = "https://google.serper.dev/news";

// Providers read API keys from process.env directly; manipulate process.env.
const ORIGINAL_ENV = {
    EXA_API_KEY: process.env.EXA_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
};

function setEnv(overrides: Partial<Record<"EXA_API_KEY" | "SERPER_API_KEY" | "SEARCH_PROVIDER", string | undefined>>) {
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

const subQueries: PlannedQuery[] = [
    { searchQuery: "test query", category: "tech", rationale: "test" },
];

function exaResponse(results: { url: string; title?: string; text?: string; score?: number }[]) {
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

function getFetchCallsByUrl(fetchSpy: jest.SpyInstance): { exa: number; serper: number } {
    const calls = fetchSpy.mock.calls as [string, unknown][];
    let exa = 0;
    let serper = 0;
    for (const [url] of calls) {
        if (url === EXA_URL) exa++;
        if (url === SERPER_URL) serper++;
    }
    return { exa, serper };
}

describe("executeSearch strategy logic", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        setEnv({
            EXA_API_KEY: "test-exa-key",
            SERPER_API_KEY: "test-serper-key",
            SEARCH_PROVIDER: undefined,
        });
        fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
            if (url === EXA_URL) {
                return Promise.resolve(exaResponse([{ url: "https://exa.ai/1", title: "T", text: "C", score: 0.9 }]));
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

    afterAll(() => {
        setEnv(ORIGINAL_ENV);
    });

    describe("default strategy (no env) uses Exa only", () => {
        it("when SEARCH_PROVIDER is unset, only Exa is called and providerUsed is exa", async () => {
            setEnv({ SEARCH_PROVIDER: undefined, SERPER_API_KEY: "test-serper-key" });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(exa).toBe(1);
            expect(serper).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://exa.ai/1");
        });
    });

    describe('"serper" strategy uses Serper only', () => {
        it("when strategy is serper, only Serper is called and providerUsed is serper", async () => {
            setEnv({ SEARCH_PROVIDER: "serper" });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(exa).toBe(0);
            expect(serper).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://serper.com/1");
        });
    });

    describe('"fallback" strategy tries Serper first, falls back to Exa on total failure', () => {
        it("when Serper returns no results for all sub-queries, Exa is called and providerUsed is exa", async () => {
            setEnv({ SEARCH_PROVIDER: "fallback" });
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([])); // empty
                }
                if (url === EXA_URL) {
                    return Promise.resolve(exaResponse([{ url: "https://exa.ai/fallback", title: "T", text: "C", score: 0.8 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(exa).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://exa.ai/fallback");
        });
    });

    describe('"fallback" strategy does NOT fall back when Serper returns results', () => {
        it("when Serper returns results, Exa is not called and providerUsed is serper", async () => {
            setEnv({ SEARCH_PROVIDER: "fallback" });
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([{ link: "https://serper.com/ok", title: "S", snippet: "S" }]));
                }
                if (url === EXA_URL) {
                    return Promise.resolve(exaResponse([{ url: "https://exa.ai/1", title: "T", text: "C", score: 0.9 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(exa).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://serper.com/ok");
        });
    });

    describe('"parallel" strategy calls both providers and merges results', () => {
        it("when strategy is parallel, both Serper and Exa are called and providerUsed is exa+serper", async () => {
            setEnv({ SEARCH_PROVIDER: "parallel" });
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([{ link: "https://serper.com/1", title: "S", snippet: "S" }]));
                }
                if (url === EXA_URL) {
                    return Promise.resolve(exaResponse([{ url: "https://exa.ai/1", title: "T", text: "C", score: 0.9 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa+serper");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(exa).toBe(1);
            expect(results).toHaveLength(2);
            const urls = results.map((r) => r.url).sort();
            expect(urls).toEqual(["https://exa.ai/1", "https://serper.com/1"]);
        });
    });

    describe('"parallel" strategy deduplicates by URL (first provider wins)', () => {
        it("when both providers return the same URL, Serper row is kept — scores are not comparable across providers", async () => {
            setEnv({ SEARCH_PROVIDER: "parallel" });
            const sameUrl = "https://example.com/same";
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(
                        serperResponse([{ link: sameUrl, title: "From Serper", snippet: "S" }])
                    );
                }
                if (url === EXA_URL) {
                    return Promise.resolve(
                        exaResponse([{ url: sameUrl, title: "From Exa", text: "C", score: 0.95 }])
                    );
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa+serper");
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe(sameUrl);
            // One Serper hit: rank 1 of 1 → score 0 (see serper adapter); Exa is ignored for this URL.
            expect(results[0]!.score).toBe(0);
            expect(results[0]!.title).toBe("From Serper");
        });
    });

    describe('missing Serper key with "serper" strategy downgrades to "exa"', () => {
        it("when SEARCH_PROVIDER is serper but SERPER_API_KEY is unset, only Exa is called and providerUsed is exa", async () => {
            setEnv({ SEARCH_PROVIDER: "serper", SERPER_API_KEY: undefined });
            const warnSpy = jest.spyOn(console, "warn").mockImplementation();

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(exa).toBe(1);
            expect(serper).toBe(0);
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://exa.ai/1");
            expect(warnSpy).toHaveBeenCalledWith(
                "[web-search] SERPER_API_KEY not set; downgrading strategy to exa."
            );
            warnSpy.mockRestore();
        });
    });

    describe("missing EXA_API_KEY on exa path", () => {
        it("returns empty results, providerUsed none, and does not call Exa API", async () => {
            setEnv({ SEARCH_PROVIDER: undefined, EXA_API_KEY: undefined, SERPER_API_KEY: "test-serper-key" });
            const warnSpy = jest.spyOn(console, "warn").mockImplementation();

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("none");
            expect(results).toHaveLength(0);
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(exa).toBe(0);
            expect(serper).toBe(0);

            warnSpy.mockRestore();
        });
    });

    describe('"parallel" with Serper key but no Exa key', () => {
        it("uses providerUsed serper and only Serper fetch is made", async () => {
            setEnv({ SEARCH_PROVIDER: "parallel", SERPER_API_KEY: "test-serper-key", EXA_API_KEY: undefined });
            fetchSpy.mockImplementation((input: RequestInfo | URL) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
                if (url === SERPER_URL) {
                    return Promise.resolve(serperResponse([{ link: "https://serper.com/1", title: "S", snippet: "S" }]));
                }
                if (url === EXA_URL) {
                    return Promise.resolve(exaResponse([{ url: "https://exa.ai/1", title: "T", text: "C", score: 0.9 }]));
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`));
            });

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://serper.com/1");
            const { exa, serper } = getFetchCallsByUrl(fetchSpy);
            expect(serper).toBe(1);
            expect(exa).toBe(0);
        });
    });
});
