/**
 * Property-based and unit tests for Web Search Executor (executeSearch).
 * Feature: ai-trend-search-engine — news search through the configured provider.
 * Property 6: Every sub-query triggers exactly one news search on the active provider.
 * Property 6b: Results come only from the active provider, de-duplicated, scored in (0, 1].
 * Property 6c: A failing sub-query is retried up to 2 more times, then given up.
 * Unit: edge cases 3.3 (zero results), 3.4 (retries then fail), all sub-queries failing,
 *       the Exa news request.
 */

import * as fc from "fast-check";
import { executeSearch } from "@launchstack/pipelines/trend-search/web-search";
import type { PlannedQuery, SearchCategory } from "@launchstack/pipelines/trend-search";
import { SEARCH_PROVIDER_IDS, type SearchProviderId } from "@launchstack/tools/web-research";

// ─── Environment ─────────────────────────────────────────────────────────────

const SEARCH_ENV = [
    "SEARCH_PROVIDER",
    "EXA_API_KEY",
    "SERPER_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "TAVILY_API_KEY",
    "SEARXNG_URL",
] as const;
const ORIGINAL_ENV = Object.fromEntries(SEARCH_ENV.map(name => [name, process.env[name]]));

const SEARXNG_BASE = "http://searxng.test:8080";

const CREDENTIALS: Record<SearchProviderId, readonly [string, string]> = {
    exa: ["EXA_API_KEY", "test-exa-key"],
    serper: ["SERPER_API_KEY", "test-serper-key"],
    brave: ["BRAVE_SEARCH_API_KEY", "test-brave-key"],
    tavily: ["TAVILY_API_KEY", "test-tavily-key"],
    searxng: ["SEARXNG_URL", SEARXNG_BASE],
};

/** Clears every search setting, then sets the credentials for `ids` and SEARCH_PROVIDER. */
function configure(ids: readonly SearchProviderId[], setting?: string) {
    for (const name of SEARCH_ENV) delete process.env[name];
    for (const id of ids) {
        const [name, value] = CREDENTIALS[id];
        process.env[name] = value;
    }
    if (setting !== undefined) process.env.SEARCH_PROVIDER = setting;
}

// ─── Fake engines ────────────────────────────────────────────────────────────

interface Item {
    url: string;
    title: string;
    content: string;
}

interface Call {
    provider: SearchProviderId | null;
    url: string;
    query: string;
    body: Record<string, unknown> | null;
}

/** An answer: items, an HTTP status to fail with, or an Error to reject with (network failure). */
type Reply = Item[] | number | Error;
type Responder = (provider: SearchProviderId, query: string, attempt: number) => Reply;

let respond: Responder = () => [];
let calls: Call[] = [];

function resetWeb(responder: Responder) {
    respond = responder;
    calls = [];
}

/** The news endpoint each provider must be asked. */
const NEWS_ENDPOINT: Record<SearchProviderId, string> = {
    exa: "https://api.exa.ai/search",
    serper: "https://google.serper.dev/news",
    brave: "https://api.search.brave.com/res/v1/news/search",
    tavily: "https://api.tavily.com/search",
    searxng: `${SEARXNG_BASE}/search`,
};

function providerOf(url: string): SearchProviderId | null {
    if (url === "https://api.exa.ai/search") return "exa";
    if (url.startsWith("https://google.serper.dev/")) return "serper";
    if (url.startsWith("https://api.search.brave.com/")) return "brave";
    if (url === "https://api.tavily.com/search") return "tavily";
    if (url.startsWith(`${SEARXNG_BASE}/`)) return "searxng";
    return null;
}

/** Whether a request is that provider's news search (and not its web search). */
function isNewsRequest(call: Call): boolean {
    if (!call.provider) return false;
    const url = new URL(call.url);
    if (url.origin + url.pathname !== NEWS_ENDPOINT[call.provider]) return false;
    switch (call.provider) {
        case "exa":
            return call.body?.category === "news";
        case "tavily":
            return call.body?.topic === "news";
        case "searxng":
            return url.searchParams.get("categories") === "news";
        default:
            return true;
    }
}

/** `items` in `provider`'s own news response shape. */
function answer(provider: SearchProviderId, items: Item[]): unknown {
    switch (provider) {
        case "exa":
            return { results: items.map(i => ({ url: i.url, title: i.title, text: i.content })) };
        case "serper":
            return {
                news: items.map(i => ({ link: i.url, title: i.title, snippet: i.content })),
            };
        case "brave":
            return {
                results: items.map(i => ({ url: i.url, title: i.title, description: i.content })),
            };
        case "tavily":
        case "searxng":
            return {
                results: items.map(i => ({ url: i.url, title: i.title, content: i.content })),
            };
    }
}

function okResponse(body: unknown) {
    return { ok: true, status: 200, json: async () => body } as Response;
}

function errorResponse(status: number) {
    return {
        ok: false,
        status,
        body: null,
        json: async () => {
            throw new Error("not json");
        },
    } as unknown as Response;
}

function urlOf(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlOf(input);
    const provider = providerOf(url);
    const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const params = new URL(url).searchParams;
    const fromBody = body?.query ?? body?.q;
    const query = params.get("q") ?? (typeof fromBody === "string" ? fromBody : "");
    const attempt = calls.filter(c => c.provider === provider && c.query === query).length;
    calls.push({ provider, url, query, body });
    if (!provider) throw new Error(`Unexpected URL: ${url}`);
    const reply = respond(provider, query, attempt);
    if (reply instanceof Error) throw reply;
    return typeof reply === "number" ? errorResponse(reply) : okResponse(answer(provider, reply));
}

let fetchSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
    configure(["exa"]);
    resetWeb(() => []);
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const name of SEARCH_ENV) {
        const value = ORIGINAL_ENV[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validCategories = [
    "fashion",
    "finance",
    "business",
    "tech",
] as const satisfies readonly SearchCategory[];

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

const providerArb = fc.constantFrom(...SEARCH_PROVIDER_IDS);

/** How the active provider is chosen: named with every provider configured, or the only key. */
const selectionArb = fc.constantFrom("named", "only-key");

function activate(provider: SearchProviderId, how: "named" | "only-key") {
    if (how === "named") configure(SEARCH_PROVIDER_IDS, provider);
    else configure([provider]);
}

/** Each provider answers with up to `n` URLs on its own host, some shared across queries. */
function hostedAnswer(provider: SearchProviderId, query: string): Item[] {
    const n = query.length % 4;
    return Array.from({ length: n }, (_, i) => ({
        url: `https://${provider}.example/${(query.length + i) % 3}`,
        title: `${provider} ${i}`,
        content: "C",
    }));
}

function normalizeUrl(url: string): string {
    try {
        return new URL(url).href;
    } catch {
        return url.trim();
    }
}

// ─── Property 6: Every sub-query triggers a search call ───────────────────────

describe("Property 6: Every sub-query triggers exactly one news search on the active provider", () => {
    it("mock Exa called once per sub-query for any random PlannedQuery array", async () => {
        await fc.assert(
            fc.asyncProperty(plannedQueriesArb, async subQueries => {
                configure(["exa"]);
                resetWeb(() => [{ url: "https://example.com/1", title: "T", content: "C" }]);
                fetchSpy.mockClear();

                const { providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("exa");
                expect(fetchSpy).toHaveBeenCalledTimes(subQueries.length);
            }),
            { numRuns: 50 }
        );
    });

    it("for any provider, each sub-query's text goes to that provider's news search exactly once", async () => {
        await fc.assert(
            fc.asyncProperty(
                plannedQueriesArb,
                providerArb,
                selectionArb,
                async (subQueries, provider, how) => {
                    activate(provider, how);
                    resetWeb(() => []);

                    const { providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe(provider);
                    expect(calls).toHaveLength(subQueries.length);
                    for (const call of calls) {
                        expect(call.provider).toBe(provider);
                        expect(isNewsRequest(call)).toBe(true);
                    }
                    expect(calls.map(c => c.query).sort()).toEqual(
                        subQueries.map(q => q.searchQuery).sort()
                    );
                }
            ),
            { numRuns: 60 }
        );
    });
});

// ─── Property 6b: Results only from the active provider, de-duplicated ────────

describe("Property 6b: Results come only from the active provider, de-duplicated by URL", () => {
    it("for any provider and sub-queries, every result is on the active provider's host, unique, scored in (0, 1]", async () => {
        await fc.assert(
            fc.asyncProperty(
                plannedQueriesArb,
                providerArb,
                selectionArb,
                async (subQueries, provider, how) => {
                    activate(provider, how);
                    // Every provider would answer; only the active one may be asked.
                    resetWeb(hostedAnswer);

                    const { results, providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe(provider);
                    for (const r of results) {
                        expect(new URL(r.url).host).toBe(`${provider}.example`);
                        expect(r.score).toBeGreaterThan(0);
                        expect(r.score).toBeLessThanOrEqual(1);
                    }
                    const keys = results.map(r => normalizeUrl(r.url));
                    expect(new Set(keys).size).toBe(keys.length);
                    // Nothing an answer held is lost by the merge.
                    const answered = new Set(
                        subQueries.flatMap(q =>
                            hostedAnswer(provider, q.searchQuery).map(i => normalizeUrl(i.url))
                        )
                    );
                    expect(new Set(keys)).toEqual(answered);
                }
            ),
            { numRuns: 60 }
        );
    });
});

// ─── Property 6c: Retries ─────────────────────────────────────────────────────

describe("Property 6c: A failing sub-query is retried up to 2 more times, then given up", () => {
    it("for k leading failures, the sub-query is asked min(k + 1, 3) times and answers only when k < 3", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.nat({ max: 5 }),
                providerArb,
                fc.constantFrom<"network" | 500 | 503 | 429>("network", 500, 503, 429),
                async (failures, provider, failure) => {
                    configure([provider]);
                    resetWeb((p, _query, attempt) => {
                        if (attempt < failures) {
                            return failure === "network" ? new Error("socket hang up") : failure;
                        }
                        return [{ url: `https://${p}.example/ok`, title: "OK", content: "C" }];
                    });

                    const { results, providerUsed } = await executeSearch([
                        { searchQuery: "flaky", category: "tech", rationale: "r" },
                    ]);

                    expect(providerUsed).toBe(provider);
                    expect(calls).toHaveLength(Math.min(failures + 1, 3));
                    expect(calls.every(c => c.provider === provider)).toBe(true);
                    expect(results.map(r => r.url)).toEqual(
                        failures < 3 ? [`https://${provider}.example/ok`] : []
                    );
                }
            ),
            { numRuns: 60 }
        );
    });
});

// ─── Unit test: One sub-query returns 0 results, pipeline continues (edge 3.3) ─

describe("Unit: one sub-query returns 0 results, pipeline continues", () => {
    it("when one sub-query returns 0 results, pipeline continues and returns results from others", async () => {
        const subQueries: PlannedQuery[] = [
            { searchQuery: "q1", category: "tech", rationale: "r1" },
            { searchQuery: "q2", category: "business", rationale: "r2" },
            { searchQuery: "q3", category: "finance", rationale: "r3" },
        ];
        resetWeb((_p, query) => {
            if (query === "q1") return [];
            if (query === "q2") return [{ url: "https://b.com", title: "B", content: "C2" }];
            return [{ url: "https://c.com", title: "C", content: "C3" }];
        });

        const { results, providerUsed } = await executeSearch(subQueries);

        expect(providerUsed).toBe("exa");
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(results).toHaveLength(2);
        expect(results.map(r => r.url)).toEqual(["https://b.com", "https://c.com"]);
    });
});

// ─── Unit test: fails, retries 2 times then sub-query failed (edge 3.4) ──────

describe("Unit: the provider fails, retries 2 times then marks sub-query failed", () => {
    it.each([
        ["a network error", new Error("Exa unreachable")],
        ["HTTP 500", 500],
    ] as const)(
        "when %s fails one sub-query 3 times, that sub-query is skipped and others still run",
        async (_label, failure) => {
            const subQueries: PlannedQuery[] = [
                { searchQuery: "failing-query", category: "tech", rationale: "r1" },
                { searchQuery: "ok-query", category: "business", rationale: "r2" },
            ];
            resetWeb((_p, query) =>
                query === "failing-query"
                    ? failure
                    : [{ url: "https://ok.com", title: "OK", content: "Content" }]
            );

            const { results, providerUsed } = await executeSearch(subQueries);

            // 3 attempts (initial + 2 retries) for failing query, 1 attempt for ok-query
            expect(fetchSpy).toHaveBeenCalledTimes(4);
            expect(calls.filter(c => c.query === "failing-query")).toHaveLength(3);
            expect(providerUsed).toBe("exa");
            expect(results).toHaveLength(1);
            expect(results[0]!.url).toBe("https://ok.com");
            // Two retry warnings, then one error when it gives up.
            expect(warnSpy).toHaveBeenCalledTimes(2);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(String(errorSpy.mock.calls[0]![0])).toContain("failed after 3 attempts");
        }
    );

    it("when every sub-query fails, results are empty but providerUsed still names the provider", async () => {
        configure(["searxng"]);
        resetWeb(() => 502);

        const { results, providerUsed } = await executeSearch([
            { searchQuery: "a", category: "tech", rationale: "r" },
            { searchQuery: "b", category: "tech", rationale: "r" },
        ]);

        expect(providerUsed).toBe("searxng");
        expect(results).toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(6);
        expect(errorSpy).toHaveBeenCalledTimes(2);
    });
});

// ─── Unit: the request executeSearch sends ───────────────────────────────────

describe("Unit: the news request", () => {
    it("asks Exa for 10 news results with up to 4,000 characters of text each", async () => {
        await executeSearch([
            { searchQuery: "coffee prices", category: "finance", rationale: "r" },
        ]);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe("https://api.exa.ai/search");
        expect(calls[0]!.body).toEqual({
            query: "coffee prices",
            type: "auto",
            category: "news",
            numResults: 10,
            contents: { text: { maxCharacters: 4000 } },
        });
    });

    it("searches nothing for an empty sub-query list", async () => {
        const { results, providerUsed } = await executeSearch([]);

        expect(providerUsed).toBe("exa");
        expect(results).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
