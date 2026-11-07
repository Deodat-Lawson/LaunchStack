/**
 * Unit tests for which engine executeSearch (trend research news search) uses.
 * Feature: provider-agnostic web search — one SEARCH_PROVIDER for every feature.
 *
 *  - Unset: the first configured provider wins, in the order
 *    exa → serper → brave → tavily → searxng.
 *  - Named and configured: that provider, whatever else is configured.
 *  - Named without its credential: search is off (providerUsed "none", no
 *    request), never a quiet switch to another engine.
 *  - The retired strategies `fallback` and `parallel` count as unset: one
 *    engine, never two.
 *  - Anything else: search is off.
 */

import { executeSearch } from "@launchstack/pipelines/trend-search/web-search";
import type { PlannedQuery } from "@launchstack/pipelines/trend-search";
import type {
    SearchProviderId,
    SearchProviderUsed,
} from "@launchstack/pipelines/trend-search/providers/types";
import { resolveSearchSetup, SEARCH_PROVIDER_IDS } from "@launchstack/tools/web-research";

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

/** Which provider a request went to, from its URL. */
function providerOf(url: string): SearchProviderId | null {
    if (url === "https://api.exa.ai/search") return "exa";
    if (url.startsWith("https://google.serper.dev/")) return "serper";
    if (url.startsWith("https://api.search.brave.com/")) return "brave";
    if (url === "https://api.tavily.com/search") return "tavily";
    if (url.startsWith(`${SEARXNG_BASE}/`)) return "searxng";
    return null;
}

/** Each provider answers with one hit on its own host, in its own response shape. */
function answerFor(provider: SearchProviderId): unknown {
    const url = `https://${provider}.example/1`;
    switch (provider) {
        case "exa":
            return { results: [{ url, title: "Exa hit", text: "C" }] };
        case "serper":
            return { news: [{ link: url, title: "Serper hit", snippet: "S" }] };
        case "brave":
            return { results: [{ url, title: "Brave hit", description: "B" }] };
        case "tavily":
            return { results: [{ url, title: "Tavily hit", content: "T" }] };
        case "searxng":
            return { results: [{ url, title: "SearXNG hit", content: "X" }] };
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

const subQueries: PlannedQuery[] = [
    { searchQuery: "test query", category: "tech", rationale: "test" },
];

describe("executeSearch provider selection", () => {
    let fetchSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    function callsByProvider(): Record<SearchProviderId | "other", number> {
        const counts = { exa: 0, serper: 0, brave: 0, tavily: 0, searxng: 0, other: 0 };
        for (const [input] of fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][]) {
            counts[providerOf(urlOf(input)) ?? "other"]++;
        }
        return counts;
    }

    /** Only `provider` was asked, `times` times. */
    function expectOnly(provider: SearchProviderId, times = 1) {
        const counts = callsByProvider();
        expect(counts[provider]).toBe(times);
        expect(fetchSpy).toHaveBeenCalledTimes(times);
    }

    beforeEach(() => {
        configure([]);
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
        fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation((input: RequestInfo | URL) => {
                const url = urlOf(input);
                const provider = providerOf(url);
                if (!provider) return Promise.reject(new Error(`Unexpected URL: ${url}`));
                return Promise.resolve(okResponse(answerFor(provider)));
            });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        for (const name of SEARCH_ENV) {
            const value = ORIGINAL_ENV[name];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    describe("SEARCH_PROVIDER unset: the first configured provider, in order", () => {
        it("the order is exa, serper, brave, tavily, searxng", () => {
            expect(SEARCH_PROVIDER_IDS).toEqual(["exa", "serper", "brave", "tavily", "searxng"]);
        });

        it.each(SEARCH_PROVIDER_IDS.map((id, i) => [id, SEARCH_PROVIDER_IDS.slice(i)] as const))(
            "uses %s when it and every provider after it are configured",
            async (expected, configured) => {
                configure(configured);

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe(expected);
                expectOnly(expected);
                expect(results.map(r => r.url)).toEqual([`https://${expected}.example/1`]);
            }
        );

        it.each(SEARCH_PROVIDER_IDS)("uses %s when it is the only one configured", async id => {
            configure([id]);

            const { providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe(id);
            expectOnly(id);
        });

        it("treats an empty or blank SEARCH_PROVIDER as unset", async () => {
            for (const blank of ["", "   "]) {
                fetchSpy.mockClear();
                configure(["serper", "brave"], blank);

                const { providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("serper");
                expectOnly("serper");
            }
        });

        it("treats a blank credential as unset", async () => {
            configure(["serper"]);
            process.env.EXA_API_KEY = "   ";

            const { providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expectOnly("serper");
        });

        it("returns empty results, providerUsed none, and calls nothing with no provider at all", async () => {
            configure([]);

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("none");
            expect(results).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });

    describe("SEARCH_PROVIDER names a configured provider", () => {
        it.each(SEARCH_PROVIDER_IDS)(
            "SEARCH_PROVIDER=%s uses only that provider, even with every other one configured",
            async id => {
                configure(SEARCH_PROVIDER_IDS, id);

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe(id);
                expectOnly(id);
                expect(results.map(r => r.url)).toEqual([`https://${id}.example/1`]);
            }
        );

        it("accepts the name in any case and with spaces around it", async () => {
            configure(SEARCH_PROVIDER_IDS, "  Serper ");

            const { providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expectOnly("serper");
        });

        it("sends every sub-query to the same provider", async () => {
            configure(SEARCH_PROVIDER_IDS, "tavily");
            const three: PlannedQuery[] = [
                { searchQuery: "q1", category: "tech", rationale: "r" },
                { searchQuery: "q2", category: "finance", rationale: "r" },
                { searchQuery: "q3", category: "fashion", rationale: "r" },
            ];

            const { providerUsed } = await executeSearch(three);

            expect(providerUsed).toBe("tavily");
            expectOnly("tavily", 3);
        });

        it("does not switch engines when the named provider answers nothing", async () => {
            configure(SEARCH_PROVIDER_IDS, "serper");
            fetchSpy.mockImplementation(() => Promise.resolve(okResponse({ news: [] })));

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expect(results).toEqual([]);
            expectOnly("serper");
        });

        it("does not switch engines when the named provider fails; it retries, then gives up", async () => {
            configure(SEARCH_PROVIDER_IDS, "serper");
            fetchSpy.mockImplementation(() => Promise.resolve(errorResponse(500)));

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expect(results).toEqual([]);
            // 1 attempt + 2 retries, all on Serper.
            expectOnly("serper", 3);
        });

        it("reads the setting at call time: a changed environment applies to the next search", async () => {
            configure(SEARCH_PROVIDER_IDS, "brave");
            expect((await executeSearch(subQueries)).providerUsed).toBe("brave");

            process.env.SEARCH_PROVIDER = "searxng";
            expect((await executeSearch(subQueries)).providerUsed).toBe("searxng");

            delete process.env.SEARCH_PROVIDER;
            expect((await executeSearch(subQueries)).providerUsed).toBe("exa");

            const counts = callsByProvider();
            expect([counts.brave, counts.searxng, counts.exa, counts.other]).toEqual([1, 1, 1, 0]);
        });
    });

    describe("SEARCH_PROVIDER names a provider without its credential: search is off", () => {
        it.each(SEARCH_PROVIDER_IDS)(
            "SEARCH_PROVIDER=%s without its credential searches nothing, whatever else is set",
            async id => {
                configure(
                    SEARCH_PROVIDER_IDS.filter(other => other !== id),
                    id
                );

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("none");
                expect(results).toEqual([]);
                expect(fetchSpy).not.toHaveBeenCalled();
                expect(resolveSearchSetup().problem).toBe("missing-credentials");
                // Logged once per process, naming the missing setting.
                expect(warnSpy).toHaveBeenCalledWith(
                    `[web-search] SEARCH_PROVIDER=${id} needs ${CREDENTIALS[id][0]}; web search is off.`
                );
            }
        );
    });

    describe("retired strategies fallback and parallel count as unset", () => {
        const retired = ["fallback", "parallel", "Parallel", " FALLBACK "];

        it.each(retired)(
            "SEARCH_PROVIDER=%j with Exa and Serper configured uses Exa alone, never both",
            async setting => {
                configure(["exa", "serper"], setting);

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("exa");
                expectOnly("exa");
                expect(callsByProvider().serper).toBe(0);
                expect(results.map(r => r.url)).toEqual(["https://exa.example/1"]);
            }
        );

        it.each(retired)("SEARCH_PROVIDER=%j with only a Serper key uses Serper", async setting => {
            configure(["serper"], setting);

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("serper");
            expectOnly("serper");
            expect(results.map(r => r.url)).toEqual(["https://serper.example/1"]);
        });

        it.each(["fallback", "parallel"])(
            "SEARCH_PROVIDER=%s with nothing configured searches nothing",
            async setting => {
                configure([], setting);

                const { providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("none");
                expect(fetchSpy).not.toHaveBeenCalled();
            }
        );

        it("does not fall back to another engine when the auto choice answers nothing", async () => {
            configure(["exa", "serper"], "fallback");
            fetchSpy.mockImplementation(() => Promise.resolve(okResponse({ results: [] })));

            const { results, providerUsed } = await executeSearch(subQueries);

            expect(providerUsed).toBe("exa");
            expect(results).toEqual([]);
            expectOnly("exa");
        });
    });

    describe("SEARCH_PROVIDER that names no provider: search is off", () => {
        it.each(["bing", "google", "exa+serper", "serper,exa", "duckduckgo"])(
            "SEARCH_PROVIDER=%s searches nothing even with every provider configured",
            async setting => {
                configure(SEARCH_PROVIDER_IDS, setting);

                const { results, providerUsed } = await executeSearch(subQueries);

                expect(providerUsed).toBe("none");
                expect(results).toEqual([]);
                expect(fetchSpy).not.toHaveBeenCalled();
                expect(resolveSearchSetup().problem).toBe("unknown-provider");
            }
        );
    });

    describe("each provider is asked for news", () => {
        function lastRequest(): { url: URL; body: Record<string, unknown> | null } {
            const [input, init] = fetchSpy.mock.calls.at(-1) as [RequestInfo | URL, RequestInit?];
            const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
            return { url: new URL(urlOf(input)), body };
        }

        const newsChecks: Record<
            SearchProviderId,
            (req: { url: URL; body: Record<string, unknown> | null }) => void
        > = {
            exa: ({ url, body }) => {
                expect(url.href).toBe("https://api.exa.ai/search");
                expect(body).toMatchObject({ query: "test query", category: "news" });
            },
            serper: ({ url, body }) => {
                expect(url.href).toBe("https://google.serper.dev/news");
                expect(body).toMatchObject({ q: "test query" });
            },
            brave: ({ url }) => {
                expect(url.origin + url.pathname).toBe(
                    "https://api.search.brave.com/res/v1/news/search"
                );
                expect(url.searchParams.get("q")).toBe("test query");
            },
            tavily: ({ url, body }) => {
                expect(url.href).toBe("https://api.tavily.com/search");
                expect(body).toMatchObject({ query: "test query", topic: "news" });
            },
            searxng: ({ url }) => {
                expect(url.origin + url.pathname).toBe(`${SEARXNG_BASE}/search`);
                expect(url.searchParams.get("categories")).toBe("news");
                expect(url.searchParams.get("q")).toBe("test query");
            },
        };

        it.each(SEARCH_PROVIDER_IDS)("%s gets its news search", async id => {
            configure([id], id);

            const providerUsed: SearchProviderUsed = (await executeSearch(subQueries)).providerUsed;

            expect(providerUsed).toBe(id);
            newsChecks[id](lastRequest());
        });
    });
});
