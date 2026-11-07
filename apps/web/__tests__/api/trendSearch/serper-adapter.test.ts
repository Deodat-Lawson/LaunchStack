/**
 * Unit tests for the Serper provider's news search (SEARCH_PROVIDERS.serper).
 * Feature: provider-agnostic web search — trend research reads Google News
 * through Serper when SEARCH_PROVIDER picks it (or it is the first key set).
 *
 * Covers the request (URL, headers, body), the mapping onto WebSearchHit
 * (link→url, snippet, date→publishedDate), empty and missing answers, errors
 * that name only the HTTP status, and the rank score executeSearch gives each
 * Serper hit.
 */

import {
    executeSearch,
    SEARCH_PROVIDERS,
    type ProviderSearchOptions,
} from "@launchstack/tools/web-research";

const serper = SEARCH_PROVIDERS.serper;

const SERPER_NEWS_URL = "https://google.serper.dev/news";
const SERPER_WEB_URL = "https://google.serper.dev/search";

// Every search setting, cleared before each test and restored after it, so a
// developer's real .env keys can't pick another engine or reach the network.
const SEARCH_ENV = [
    "SEARCH_PROVIDER",
    "EXA_API_KEY",
    "SERPER_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "TAVILY_API_KEY",
    "SEARXNG_URL",
] as const;
const ORIGINAL_ENV = Object.fromEntries(SEARCH_ENV.map(name => [name, process.env[name]]));

const mockFetch = jest.fn();

beforeEach(() => {
    for (const name of SEARCH_ENV) delete process.env[name];
    process.env.SERPER_API_KEY = "test-serper-key";
    mockFetch.mockReset();
    jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const name of SEARCH_ENV) {
        const value = ORIGINAL_ENV[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

function newsOptions(overrides: Partial<ProviderSearchOptions> = {}): ProviderSearchOptions {
    return { kind: "news", maxResults: 10, snippetChars: 1200, ...overrides };
}

function makeOkResponse(body: { news?: unknown[]; organic?: unknown[] }) {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
    } as Response;
}

function makeErrorResponse(status: number, body = "Error") {
    const text = jest.fn(async () => body);
    const json = jest.fn(async () => {
        throw new Error("not json");
    });
    const response = {
        ok: false,
        status,
        statusText: "Error",
        body: null,
        text,
        json,
    } as unknown as Response;
    return { response, text, json };
}

function lastRequest(): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    return { url, init };
}

describe("SEARCH_PROVIDERS.serper", () => {
    describe("identity and configuration", () => {
        it("is Serper, configured by SERPER_API_KEY", () => {
            expect(serper.id).toBe("serper");
            expect(serper.label).toBe("Serper");
            expect(serper.credential).toBe("SERPER_API_KEY");
            expect(serper.isConfigured()).toBe(true);
        });

        it("is not configured when the key is unset, empty or blank", () => {
            delete process.env.SERPER_API_KEY;
            expect(serper.isConfigured()).toBe(false);
            process.env.SERPER_API_KEY = "";
            expect(serper.isConfigured()).toBe(false);
            process.env.SERPER_API_KEY = "   ";
            expect(serper.isConfigured()).toBe(false);
        });

        it("has no company index", () => {
            expect(serper.companies).toBeUndefined();
        });
    });

    describe("news request", () => {
        it("POSTs to Google News with the API key and the US English edition", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({ news: [] }));

            await serper.search("AI trends", newsOptions({ maxResults: 7 }));

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const { url, init } = lastRequest();
            expect(url).toBe(SERPER_NEWS_URL);
            expect(init.method).toBe("POST");
            expect(init.headers).toEqual({
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-API-KEY": "test-serper-key",
            });
            expect(JSON.parse(init.body as string)).toEqual({
                q: "AI trends",
                num: 7,
                gl: "us",
                hl: "en",
            });
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });

        it("uses organic web search (no edition) only for kind web", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({ organic: [] }));

            await serper.search("AI trends", newsOptions({ kind: "web", maxResults: 5 }));

            const { url, init } = lastRequest();
            expect(url).toBe(SERPER_WEB_URL);
            expect(JSON.parse(init.body as string)).toEqual({ q: "AI trends", num: 5 });
        });

        it("asks for 10 news results per sub-query when executeSearch runs on Serper", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({ news: [] }));

            const { providerUsed } = await executeSearch([
                { searchQuery: "melon prices", category: "business", rationale: "r" },
            ]);

            expect(providerUsed).toBe("serper");
            const { url, init } = lastRequest();
            expect(url).toBe(SERPER_NEWS_URL);
            expect(JSON.parse(init.body as string)).toEqual({
                q: "melon prices",
                num: 10,
                gl: "us",
                hl: "en",
            });
        });

        it("uses an injected fetchImpl instead of the global fetch", async () => {
            const fetchImpl = jest.fn(async () => makeOkResponse({ news: [] }));

            await serper.search("q", newsOptions({ fetchImpl: fetchImpl as typeof fetch }));

            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe("valid response maps onto WebSearchHit", () => {
        it("maps link→url, title, snippet and date→publishedDate", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        {
                            title: "AI Trends 2026",
                            link: "https://example.com/1",
                            snippet: "Summary here",
                            date: "2 hours ago",
                            position: 1,
                        },
                    ],
                })
            );

            const hits = await serper.search("AI trends", newsOptions());

            expect(hits).toEqual([
                {
                    title: "AI Trends 2026",
                    url: "https://example.com/1",
                    snippet: "Summary here",
                    publishedDate: "2 hours ago",
                },
            ]);
        });

        it("falls back to the URL for a missing or blank title and to '' for a missing snippet", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://example.com/2" },
                        { link: "https://example.com/3", title: "  " },
                    ],
                })
            );

            const hits = await serper.search("query", newsOptions());

            expect(hits).toEqual([
                { title: "https://example.com/2", url: "https://example.com/2", snippet: "" },
                { title: "https://example.com/3", url: "https://example.com/3", snippet: "" },
            ]);
            expect(hits[0]).not.toHaveProperty("publishedDate");
        });

        it("collapses whitespace in the snippet and cuts it to snippetChars with an ellipsis", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://example.com/4", snippet: "  one\n two   three four  " },
                    ],
                })
            );

            const [hit] = await serper.search("query", newsOptions({ snippetChars: 9 }));

            expect(hit!.snippet).toBe("one two t…");
        });

        it("skips items without a link and returns at most maxResults", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://a.com" },
                        { title: "no link — skipped" },
                        { link: "", title: "empty link — skipped" },
                        { link: "https://b.com" },
                        { link: "https://c.com" },
                    ],
                })
            );

            const hits = await serper.search("query", newsOptions({ maxResults: 2 }));

            expect(hits.map(h => h.url)).toEqual(["https://a.com", "https://b.com"]);
        });
    });

    describe("missing SERPER_API_KEY", () => {
        it("throws naming the setting and does not call fetch", async () => {
            delete process.env.SERPER_API_KEY;

            await expect(serper.search("query", newsOptions())).rejects.toThrow(
                "Serper search needs SERPER_API_KEY."
            );
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe("non-2xx response throws naming only the status", () => {
        it("throws 'Serper search failed (HTTP 500)' and never reads the body", async () => {
            const { response, text, json } = makeErrorResponse(
                500,
                "Server down: key test-serper-key"
            );
            mockFetch.mockResolvedValue(response);

            const error = await serper.search("query", newsOptions()).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe("Serper search failed (HTTP 500)");
            expect((error as Error).message).not.toContain("Server down");
            expect((error as Error).message).not.toContain("test-serper-key");
            expect(text).not.toHaveBeenCalled();
            expect(json).not.toHaveBeenCalled();
        });

        it("throws on 401", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(401, "Invalid key").response);

            await expect(serper.search("query", newsOptions())).rejects.toThrow(
                /^Serper search failed \(HTTP 401\)$/
            );
        });

        it("throws the same way for a real Response with a streamed error body", async () => {
            mockFetch.mockResolvedValue(
                new Response("rate limited, key test-serper-key", { status: 429 })
            );

            await expect(serper.search("query", newsOptions())).rejects.toThrow(
                /^Serper search failed \(HTTP 429\)$/
            );
        });
    });

    describe("empty answers", () => {
        it("returns [] when news is an empty array", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({ news: [] }));

            await expect(serper.search("query", newsOptions())).resolves.toEqual([]);
        });

        it("returns [] when news is missing", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({}));

            await expect(serper.search("query", newsOptions())).resolves.toEqual([]);
        });

        it("reads news, not organic, for a news search", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({ organic: [{ link: "https://organic.example/" }] })
            );

            await expect(serper.search("query", newsOptions())).resolves.toEqual([]);
        });
    });

    describe("rank score through executeSearch (score = 1 - index/total)", () => {
        const subQueries = [{ searchQuery: "query", category: "tech", rationale: "r" }];

        it("first hit scores 1 and scores fall by rank", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://a.com", position: 1 },
                        { link: "https://b.com", position: 2 },
                        { link: "https://c.com", position: 3 },
                    ],
                })
            );

            const { results } = await executeSearch(subQueries);

            expect(results.map(r => r.url)).toEqual([
                "https://a.com",
                "https://b.com",
                "https://c.com",
            ]);
            expect(results[0]!.score).toBeCloseTo(1);
            expect(results[1]!.score).toBeCloseTo(2 / 3);
            expect(results[2]!.score).toBeCloseTo(1 / 3);
        });

        it("ranks only the items that have links, and ignores Serper's position", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://a.com", position: 9 },
                        { title: "no link — skipped", position: 1 },
                        { link: "https://b.com", position: 2 },
                    ],
                })
            );

            const { results } = await executeSearch(subQueries);

            expect(results.map(r => [r.url, r.score])).toEqual([
                ["https://a.com", 1],
                ["https://b.com", 0.5],
            ]);
        });

        it("carries snippet→content and date→publishedDate into RawSearchResult", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        {
                            link: "https://a.com",
                            title: "A",
                            snippet: "Summary",
                            date: "Oct 27, 2026",
                        },
                        { link: "https://b.com", title: "B" },
                    ],
                })
            );

            const { results } = await executeSearch(subQueries);

            expect(results).toEqual([
                {
                    url: "https://a.com",
                    title: "A",
                    content: "Summary",
                    score: 1,
                    publishedDate: "Oct 27, 2026",
                },
                { url: "https://b.com", title: "B", content: "", score: 0.5 },
            ]);
        });
    });
});
