/**
 * Each adapter against the response shape its vendor documents: the request
 * it sends for web and for news, and how the answer maps onto WebSearchHit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderSearchOptions } from "../types";
import { brave } from "./brave";
import { exa } from "./exa";
import { searxng, searxngSearchUrl } from "./searxng";
import { serper } from "./serper";
import { tavily } from "./tavily";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function options(
    fetchImpl: typeof fetch,
    overrides: Partial<ProviderSearchOptions> = {}
): ProviderSearchOptions {
    return { kind: "web", maxResults: 5, snippetChars: 1200, fetchImpl, ...overrides };
}

function lastCall(fetchImpl: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
    const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    return { url, init };
}

beforeEach(() => {
    vi.stubEnv("EXA_API_KEY", "exa-test");
    vi.stubEnv("SERPER_API_KEY", "serper-test");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "brave-test");
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubEnv("SEARXNG_URL", "http://searxng:8080/");
});
afterEach(() => vi.unstubAllEnvs());

describe("exa", () => {
    it("adds the news category only for news", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
        await exa.search("q", options(fetchImpl));
        expect(JSON.parse(lastCall(fetchImpl).init.body as string)).not.toHaveProperty("category");
        await exa.search("q", options(fetchImpl, { kind: "news" }));
        expect(JSON.parse(lastCall(fetchImpl).init.body as string).category).toBe("news");
    });

    it("is the one provider with a company index", () => {
        expect(exa.companies).toBeDefined();
        for (const other of [serper, brave, tavily, searxng])
            expect(other.companies).toBeUndefined();
    });
});

describe("serper", () => {
    it("reads Google News for news, in the US English edition", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                news: [
                    {
                        title: "Melon prices rise",
                        link: "https://news.example.com/melons",
                        snippet: "Up 8%.",
                        date: "2 hours ago",
                    },
                ],
            })
        );
        const hits = await serper.search("melons", options(fetchImpl, { kind: "news" }));
        const { url, init } = lastCall(fetchImpl);
        expect(url).toBe("https://google.serper.dev/news");
        expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("serper-test");
        expect(JSON.parse(init.body as string)).toEqual({
            q: "melons",
            num: 5,
            gl: "us",
            hl: "en",
        });
        expect(hits).toEqual([
            {
                title: "Melon prices rise",
                url: "https://news.example.com/melons",
                snippet: "Up 8%.",
                publishedDate: "2 hours ago",
            },
        ]);
    });
});

describe("brave", () => {
    it("searches the web with the subscription token and joins the extra snippets", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                web: {
                    results: [
                        {
                            title: "Next.js 16.4 | <strong>Next.js</strong>",
                            url: "https://nextjs.org/blog/next-16-4",
                            description: "Cache Components by <strong>default</strong> &amp; more.",
                            extra_snippets: ["Turbopack is faster.", "React 19.3 support."],
                            page_age: "2026-10-01T00:00:00",
                        },
                        { title: "no url" },
                    ],
                },
            })
        );
        const hits = await brave.search("next.js release", options(fetchImpl, { maxResults: 3 }));
        const { url, init } = lastCall(fetchImpl);
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe(
            "https://api.search.brave.com/res/v1/web/search"
        );
        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            q: "next.js release",
            count: "3",
            extra_snippets: "true",
        });
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
        expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("brave-test");
        expect(hits).toEqual([
            {
                title: "Next.js 16.4 | Next.js",
                url: "https://nextjs.org/blog/next-16-4",
                snippet:
                    "Cache Components by default & more. Turbopack is faster. React 19.3 support.",
                publishedDate: "2026-10-01T00:00:00",
            },
        ]);
    });

    it("uses the news endpoint, whose results sit at the top level", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: [
                    {
                        title: "Coffee prices",
                        url: "https://news.example/coffee",
                        description: "Up.",
                    },
                ],
            })
        );
        const hits = await brave.search("coffee", options(fetchImpl, { kind: "news" }));
        const parsed = new URL(lastCall(fetchImpl).url);
        expect(parsed.pathname).toBe("/res/v1/news/search");
        expect(parsed.searchParams.has("extra_snippets")).toBe(false);
        expect(hits.map(h => h.url)).toEqual(["https://news.example/coffee"]);
    });

    it("throws on a vendor error, naming only the status", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ error: "token brave-test" }, 401));
        await expect(brave.search("q", options(fetchImpl))).rejects.toThrow(
            /^Brave search failed \(HTTP 401\)$/
        );
    });
});

describe("tavily", () => {
    it("posts with a bearer token, topic general for the web and news for news", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: [
                    {
                        title: "EU climate grants",
                        url: "https://ec.europa.eu/grants",
                        content: "The Innovation Fund opens in November.",
                        score: 0.81,
                        published_date: null,
                    },
                ],
            })
        );
        const hits = await tavily.search("eu climate grants", options(fetchImpl));
        const { url, init } = lastCall(fetchImpl);
        expect(url).toBe("https://api.tavily.com/search");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
        expect(JSON.parse(init.body as string)).toEqual({
            query: "eu climate grants",
            topic: "general",
            search_depth: "basic",
            max_results: 5,
        });
        expect(hits).toEqual([
            {
                title: "EU climate grants",
                url: "https://ec.europa.eu/grants",
                snippet: "The Innovation Fund opens in November.",
            },
        ]);

        await tavily.search("q", options(fetchImpl, { kind: "news" }));
        expect(JSON.parse(lastCall(fetchImpl).init.body as string).topic).toBe("news");
    });
});

describe("searxng", () => {
    it("asks the instance's JSON API, general for the web and news for news", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                query: "coffee roasters",
                results: [
                    {
                        url: "https://roaster.example/",
                        title: "Roaster",
                        content: "Single origin.",
                        engine: "duckduckgo",
                        score: 3,
                    },
                    {
                        url: "https://roaster2.example/",
                        title: "Roaster 2",
                        content: "",
                        publishedDate: "2026-10-27T00:00:00",
                    },
                ],
            })
        );
        const hits = await searxng.search("coffee roasters", options(fetchImpl, { maxResults: 1 }));
        const parsed = new URL(lastCall(fetchImpl).url);
        expect(parsed.origin + parsed.pathname).toBe("http://searxng:8080/search");
        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            q: "coffee roasters",
            format: "json",
            categories: "general",
        });
        expect(hits).toEqual([
            { title: "Roaster", url: "https://roaster.example/", snippet: "Single origin." },
        ]);

        await searxng.search("q", options(fetchImpl, { kind: "news" }));
        expect(new URL(lastCall(fetchImpl).url).searchParams.get("categories")).toBe("news");
    });

    it("finds the endpoint from the root or /search, with or without a trailing slash", () => {
        expect(searxngSearchUrl("http://searxng:8080")).toBe("http://searxng:8080/search");
        expect(searxngSearchUrl("http://searxng:8080/")).toBe("http://searxng:8080/search");
        expect(searxngSearchUrl("https://s.example/searx/search/")).toBe(
            "https://s.example/searx/search"
        );
    });

    it("says a 403 is the instance refusing JSON, and how to allow it", async () => {
        const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 }));
        await expect(searxng.search("q", options(fetchImpl))).rejects.toThrow(
            "SearXNG search failed (HTTP 403): the instance does not allow format=json"
        );
    });
});
