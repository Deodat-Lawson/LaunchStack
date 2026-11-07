import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeSearch } from "./index";

const QUERY = [{ searchQuery: "produce prices this week", category: "news", rationale: "trend" }];

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

describe("executeSearch (trend search, news on purpose)", () => {
    beforeEach(() => {
        for (const name of [
            "SEARCH_PROVIDER",
            "EXA_API_KEY",
            "SERPER_API_KEY",
            "BRAVE_SEARCH_API_KEY",
            "TAVILY_API_KEY",
            "SEARXNG_URL",
        ]) {
            vi.stubEnv(name, "");
        }
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("uses Serper when it is the only key, with no SEARCH_PROVIDER set", async () => {
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        const fetchMock = vi.fn(async () =>
            jsonResponse({
                news: [{ title: "Melon prices rise", link: "https://news.example.com/melons" }],
            })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { results, providerUsed } = await executeSearch(QUERY);

        expect(providerUsed).toBe("serper");
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
            "https://google.serper.dev/news"
        );
        expect(results.map(r => r.url)).toEqual(["https://news.example.com/melons"]);
    });

    it("stays on Exa, its default, when both keys are set", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        const fetchMock = vi.fn(async () =>
            jsonResponse({ results: [{ title: "Melons", url: "https://news.example.com/m" }] })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { providerUsed } = await executeSearch(QUERY);

        expect(providerUsed).toBe("exa");
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
            "https://api.exa.ai/search"
        );
    });

    it("searches nothing without a key", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { results, providerUsed } = await executeSearch(QUERY);
        expect(providerUsed).toBe("none");
        expect(results).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("treats the retired 'parallel' strategy as unset: one engine, Exa first", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        vi.stubEnv("SEARCH_PROVIDER", "parallel");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async () =>
            jsonResponse({ results: [{ title: "Melons", url: "https://news.example.com/m" }] })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { providerUsed } = await executeSearch(QUERY);

        expect(providerUsed).toBe("exa");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(
            (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
        );
        expect(body.category).toBe("news");
    });

    it("merges sub-queries, de-duplicating by URL and ranking within each answer", async () => {
        vi.stubEnv("SEARXNG_URL", "http://searxng:8080");
        const fetchMock = vi.fn(async (url: string) =>
            jsonResponse({
                results: url.includes("q=first")
                    ? [
                          { title: "A", url: "https://a.example/" },
                          { title: "B", url: "https://b.example/" },
                      ]
                    : [{ title: "A again", url: "https://a.example/" }],
            })
        );
        vi.stubGlobal("fetch", fetchMock);

        const { results, providerUsed } = await executeSearch([
            { searchQuery: "first", category: "news", rationale: "t" },
            { searchQuery: "second", category: "news", rationale: "t" },
        ]);

        expect(providerUsed).toBe("searxng");
        expect(results.map(r => [r.url, r.score])).toEqual([
            ["https://a.example/", 1],
            ["https://b.example/", 0.5],
        ]);
    });
});
