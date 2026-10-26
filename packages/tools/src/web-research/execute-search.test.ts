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
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
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
});
