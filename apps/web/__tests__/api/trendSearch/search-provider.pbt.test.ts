/**
 * Property-based tests for search provider normalization and selection.
 * Feature: provider-agnostic web search (SEARCH_PROVIDER) — executeSearch.
 * Property 13: Serper news answers normalize to WebSearchHit / RawSearchResult.
 * Property 14: A provider that answers nothing is never backed up by another engine.
 * Property 15: Sub-query answers merge de-duplicated by URL (first answer wins),
 *              scored by rank within each answer.
 * Property 16: SEARCH_PROVIDER unset → the first configured provider serves every sub-query.
 * Property 17: A named provider without its credential, or a name that isn't a
 *              provider, turns search off; retired fallback/parallel → one engine.
 */

import * as fc from "fast-check";
import { executeSearch } from "@launchstack/pipelines/trend-search/web-search";
import type { PlannedQuery, RawSearchResult } from "@launchstack/pipelines/trend-search";
import {
    SEARCH_PROVIDER_IDS,
    SEARCH_PROVIDERS,
    type SearchProviderId,
    type WebSearchHit,
} from "@launchstack/tools/web-research";

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
    query: string;
}

/** Answers `query` on `provider`; an Item list, or an HTTP status to fail with. */
type Responder = (provider: SearchProviderId, query: string) => Item[] | number;

let respond: Responder = () => [];
let calls: Call[] = [];

function resetWeb(responder: Responder) {
    respond = responder;
    calls = [];
}

function providerOf(url: string): SearchProviderId | null {
    if (url === "https://api.exa.ai/search") return "exa";
    if (url.startsWith("https://google.serper.dev/")) return "serper";
    if (url.startsWith("https://api.search.brave.com/")) return "brave";
    if (url === "https://api.tavily.com/search") return "tavily";
    if (url.startsWith(`${SEARXNG_BASE}/`)) return "searxng";
    return null;
}

/** The query text a request carries: the `q` parameter (Brave, SearXNG) or the JSON body. */
function queryOf(url: string, init?: RequestInit): string {
    const params = new URL(url).searchParams;
    if (params.has("q")) return params.get("q")!;
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        query?: string;
        q?: string;
    };
    return body.query ?? body.q ?? "";
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
    const query = provider ? queryOf(url, init) : "";
    calls.push({ provider, query });
    if (!provider) throw new Error(`Unexpected URL: ${url}`);
    const reply = respond(provider, query);
    return typeof reply === "number" ? errorResponse(reply) : okResponse(answer(provider, reply));
}

function callsTo(provider: SearchProviderId): number {
    return calls.filter(c => c.provider === provider).length;
}

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
    configure([]);
    resetWeb(() => []);
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
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

const validCategories = ["fashion", "finance", "business", "tech"] as const;

const categoryArb = fc.constantFrom(...validCategories);

const plannedQueryArb: fc.Arbitrary<PlannedQuery> = fc.record({
    searchQuery: fc.string({ minLength: 1, maxLength: 300 }),
    category: categoryArb,
    rationale: fc.string({ minLength: 1, maxLength: 200 }),
});

const subQueriesArb = fc.array(plannedQueryArb, { minLength: 1, maxLength: 5 });

/** Sub-queries with distinct text, so each one can get its own answer. */
const distinctSubQueriesArb = fc.uniqueArray(plannedQueryArb, {
    minLength: 1,
    maxLength: 5,
    selector: q => q.searchQuery,
});

const providerArb = fc.constantFrom(...SEARCH_PROVIDER_IDS);

/** A non-empty set of configured providers, in no particular order. */
const configuredArb = fc.shuffledSubarray([...SEARCH_PROVIDER_IDS], { minLength: 1 });

/** Serper news item shape (subset we use); some items have no usable link. */
const serperNewsItemArb = fc.record({
    link: fc.option(fc.oneof(fc.webUrl({ validSchemes: ["https"] }), fc.constant("")), {
        nil: undefined,
    }),
    title: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
    snippet: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
    date: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    position: fc.option(fc.nat({ max: 20 }), { nil: undefined }),
});

const serperNewsArrayArb = fc.array(serperNewsItemArb, { minLength: 0, maxLength: 15 });

/**
 * URLs drawn mostly from a small pool so answers overlap. The pool has
 * spellings that normalize to the same URL (trailing slash, host case).
 */
const URL_POOL = [
    "https://a.example",
    "https://a.example/",
    "https://b.example/story",
    "https://B.EXAMPLE/story",
    "https://c.example/news?id=1",
    "https://d.example/x",
];
const urlArb = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...URL_POOL) },
    { weight: 1, arbitrary: fc.webUrl({ validSchemes: ["https"] }) }
);

/** One answer: up to 12 URLs (providers keep the first 10). */
const answerUrlsArb = fc.array(urlArb, { minLength: 0, maxLength: 12 });

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
        (!("publishedDate" in o) || typeof o.publishedDate === "string")
    );
}

// ─── Property 13: Serper output conforms to WebSearchHit / RawSearchResult ────

describe("Property 13: Serper news answers normalize to WebSearchHit and RawSearchResult", () => {
    it("for any Serper news array, the adapter keeps linked items in order, at most maxResults, well-formed", async () => {
        await fc.assert(
            fc.asyncProperty(
                serperNewsArrayArb,
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 300 }),
                async (news, maxResults, snippetChars) => {
                    configure(["serper"]);
                    fetchSpy.mockClear();
                    fetchSpy.mockResolvedValueOnce(okResponse({ news }));

                    const hits: WebSearchHit[] = await SEARCH_PROVIDERS.serper.search(
                        "test query",
                        { kind: "news", maxResults, snippetChars }
                    );

                    const linked = news.filter(n => typeof n.link === "string" && n.link !== "");
                    expect(hits).toHaveLength(Math.min(maxResults, linked.length));
                    hits.forEach((hit, i) => {
                        const source = linked[i]!;
                        expect(Object.keys(hit).sort()).toEqual(
                            source.date
                                ? ["publishedDate", "snippet", "title", "url"]
                                : ["snippet", "title", "url"]
                        );
                        expect(hit.url).toBe(source.link);
                        const title = source.title?.trim() ?? "";
                        expect(hit.title).toBe(title === "" ? source.link : title);
                        expect(hit.title.length).toBeGreaterThan(0);
                        expect(typeof hit.snippet).toBe("string");
                        expect(hit.snippet).toBe(hit.snippet.trim());
                        expect(hit.snippet.length).toBeLessThanOrEqual(snippetChars + 1);
                        if (source.date) expect(hit.publishedDate).toBe(source.date);
                    });
                }
            ),
            { numRuns: 80 }
        );
    });

    it("through executeSearch, every Serper result conforms to RawSearchResult with a rank score in (0, 1]", async () => {
        await fc.assert(
            fc.asyncProperty(serperNewsArrayArb, async news => {
                configure(["serper"]);
                fetchSpy.mockClear();
                fetchSpy.mockResolvedValueOnce(okResponse({ news }));

                const { results, providerUsed } = await executeSearch([
                    { searchQuery: "q", category: "tech", rationale: "r" },
                ]);

                expect(fetchSpy).toHaveBeenCalledTimes(1);
                expect(providerUsed).toBe("serper");
                expect(results.length).toBeLessThanOrEqual(10);
                for (const item of results) {
                    expect(conformsToRawSearchResult(item)).toBe(true);
                    expect(item.score).toBeGreaterThan(0);
                    expect(item.score).toBeLessThanOrEqual(1);
                }
                if (results.length > 0) expect(results[0]!.score).toBe(1);
            }),
            { numRuns: 80 }
        );
    });
});

// ─── Property 14: No backup engine when the provider answers nothing ──────────

describe("Property 14: A provider that answers nothing is never backed up by another engine", () => {
    it("for random sub-queries and any named provider, an empty answer asks no other provider and returns []", async () => {
        await fc.assert(
            fc.asyncProperty(subQueriesArb, providerArb, async (subQueries, named) => {
                configure(SEARCH_PROVIDER_IDS, named);
                resetWeb(() => []);

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe(named);
                expect(results).toEqual([]);
                expect(callsTo(named)).toBe(subQueries.length);
                expect(calls).toHaveLength(subQueries.length);
            }),
            { numRuns: 50 }
        );
    });

    it("for any named provider, a failing answer is retried on that provider only, then given up", async () => {
        await fc.assert(
            fc.asyncProperty(
                subQueriesArb,
                providerArb,
                fc.constantFrom(429, 500, 502, 503),
                async (subQueries, named, status) => {
                    configure(SEARCH_PROVIDER_IDS, named);
                    resetWeb(() => status);

                    const { results, providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe(named);
                    expect(results).toEqual([]);
                    // 1 attempt + 2 retries per sub-query, all on the named provider.
                    expect(callsTo(named)).toBe(subQueries.length * 3);
                    expect(calls).toHaveLength(subQueries.length * 3);
                }
            ),
            { numRuns: 30 }
        );
    });
});

// ─── Property 15: Merge de-duplicates by URL, first answer wins ──────────────

describe("Property 15: Sub-query answers merge de-duplicated by URL (first answer wins)", () => {
    it("for random overlapping answers on any provider, the merge equals the first-seen URLs with rank scores", async () => {
        await fc.assert(
            fc.asyncProperty(
                distinctSubQueriesArb,
                fc.array(answerUrlsArb, { minLength: 5, maxLength: 5 }),
                providerArb,
                async (subQueries, answerUrls, provider) => {
                    configure([provider]);
                    // Titles name the sub-query and rank, so the winner of a URL tie is visible.
                    const answers = new Map<string, Item[]>(
                        subQueries.map((sub, s) => [
                            sub.searchQuery,
                            answerUrls[s]!.map((url, r) => ({
                                url,
                                title: `q${s}-r${r}`,
                                content: `content ${s}.${r}`,
                            })),
                        ])
                    );
                    resetWeb((_p, query) => answers.get(query) ?? []);

                    // Expected: each answer cut to 10, scored 1 - rank/length, merged in
                    // sub-query order keeping the first row for each normalized URL.
                    const seen = new Set<string>();
                    const expected: Array<Pick<RawSearchResult, "url" | "title" | "score">> = [];
                    for (const sub of subQueries) {
                        const kept = answers.get(sub.searchQuery)!.slice(0, 10);
                        kept.forEach((item, i) => {
                            const key = normalizeUrl(item.url);
                            if (seen.has(key)) return;
                            seen.add(key);
                            expected.push({
                                url: item.url,
                                title: item.title,
                                score: Math.max(0, 1 - i / kept.length),
                            });
                        });
                    }

                    const { results, providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe(provider);
                    expect(
                        results.map(r => ({ url: r.url, title: r.title, score: r.score }))
                    ).toEqual(expected);
                    const keys = results.map(r => normalizeUrl(r.url));
                    expect(new Set(keys).size).toBe(keys.length);
                }
            ),
            { numRuns: 60 }
        );
    });
});

// ─── Property 16: Unset SEARCH_PROVIDER → first configured provider ──────────

describe("Property 16: SEARCH_PROVIDER unset uses the first configured provider for every sub-query", () => {
    it("for any non-empty set of configured providers, providerUsed is the first in order and only it is called", async () => {
        await fc.assert(
            fc.asyncProperty(configuredArb, subQueriesArb, async (configured, subQueries) => {
                configure(configured);
                resetWeb(provider => [
                    { url: `https://${provider}.example/1`, title: "T", content: "C" },
                ]);
                const expected = SEARCH_PROVIDER_IDS.find(id => configured.includes(id))!;

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe(expected);
                expect(callsTo(expected)).toBe(subQueries.length);
                expect(calls).toHaveLength(subQueries.length);
                expect(results.map(r => r.url)).toEqual([`https://${expected}.example/1`]);
            }),
            { numRuns: 50 }
        );
    });

    it("for any configured set, naming one of them uses it, whatever comes first in order", async () => {
        await fc.assert(
            fc.asyncProperty(
                configuredArb.chain(configured =>
                    fc.tuple(fc.constant(configured), fc.constantFrom(...configured))
                ),
                subQueriesArb,
                async ([configured, named], subQueries) => {
                    configure(configured, named);
                    resetWeb(() => []);

                    const { providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe(named);
                    expect(callsTo(named)).toBe(subQueries.length);
                    expect(calls).toHaveLength(subQueries.length);
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ─── Property 17: Search off for a missing credential or an unknown name ─────

describe("Property 17: A named provider without its credential, or no provider name, turns search off", () => {
    it("for any named provider and any other providers configured, a missing credential searches nothing", async () => {
        await fc.assert(
            fc.asyncProperty(
                providerArb.chain(named =>
                    fc.tuple(
                        fc.constant(named),
                        fc.subarray(SEARCH_PROVIDER_IDS.filter(id => id !== named))
                    )
                ),
                subQueriesArb,
                async ([named, others], subQueries) => {
                    configure(others, named);

                    const { results, providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe("none");
                    expect(results).toEqual([]);
                    expect(calls).toHaveLength(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    it("for any value that names no provider, nothing is searched even with every provider configured", async () => {
        const reserved = new Set<string>([...SEARCH_PROVIDER_IDS, "fallback", "parallel"]);
        await fc.assert(
            fc.asyncProperty(
                fc
                    .stringMatching(/^[A-Za-z0-9+_, -]{1,16}$/)
                    .filter(s => s.trim() !== "" && !reserved.has(s.trim().toLowerCase())),
                subQueriesArb,
                async (setting, subQueries) => {
                    configure(SEARCH_PROVIDER_IDS, setting);

                    const { results, providerUsed } = await executeSearch(subQueries);

                    expect(providerUsed).toBe("none");
                    expect(results).toEqual([]);
                    expect(calls).toHaveLength(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    it("for the retired fallback/parallel strategies, exactly one engine (the first configured) is used", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom("fallback", "parallel", "Fallback", "PARALLEL", " parallel "),
                fc.subarray([...SEARCH_PROVIDER_IDS]),
                subQueriesArb,
                async (setting, configured, subQueries) => {
                    configure(configured, setting);
                    resetWeb(() => []);
                    const expected = SEARCH_PROVIDER_IDS.find(id => configured.includes(id));

                    const { providerUsed } = await executeSearch(subQueries);

                    if (!expected) {
                        expect(providerUsed).toBe("none");
                        expect(calls).toHaveLength(0);
                        return;
                    }
                    expect(providerUsed).toBe(expected);
                    expect(callsTo(expected)).toBe(subQueries.length);
                    expect(calls).toHaveLength(subQueries.length);
                }
            ),
            { numRuns: 50 }
        );
    });
});
