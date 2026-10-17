import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configuredWebSearchProvider, searchWeb } from "./web-search";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("configuredWebSearchProvider", () => {
    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("is null without a key", () => {
        expect(configuredWebSearchProvider()).toBeNull();
    });

    it("prefers Exa, and Serper when SEARCH_PROVIDER names it", () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        expect(configuredWebSearchProvider()).toBe("exa");
        vi.stubEnv("SEARCH_PROVIDER", "serper");
        expect(configuredWebSearchProvider()).toBe("serper");
    });

    it("uses whichever key is set", () => {
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        expect(configuredWebSearchProvider()).toBe("serper");
    });
});

describe("searchWeb", () => {
    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("searches the whole web on Exa (no news category) and clips the text", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: [
                    {
                        title: "Node.js 26 released",
                        url: "https://nodejs.org/en/blog/release",
                        text: "Line one.\n\n   Line two. ".repeat(3),
                        publishedDate: "2026-10-14",
                    },
                    { title: "No URL" },
                ],
            })
        );

        const { provider, results } = await searchWeb("latest node release", {
            maxResults: 3,
            snippetChars: 20,
            fetchImpl,
        });

        expect(provider).toBe("exa");
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.exa.ai/search");
        expect((init.headers as Record<string, string>)["x-api-key"]).toBe("exa-test");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toEqual({
            query: "latest node release",
            type: "auto",
            numResults: 3,
            contents: { text: { maxCharacters: 20 } },
        });
        expect(body).not.toHaveProperty("category");
        expect(results).toEqual([
            {
                title: "Node.js 26 released",
                url: "https://nodejs.org/en/blog/release",
                snippet: "Line one. Line two. …",
                publishedDate: "2026-10-14",
            },
        ]);
    });

    it("uses Serper's web endpoint, not its news endpoint", async () => {
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                organic: [
                    { title: "Timetable", link: "https://example.com/t", snippet: "Trains." },
                ],
            })
        );

        const { provider, results } = await searchWeb("train timetable", { fetchImpl });

        expect(provider).toBe("serper");
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://google.serper.dev/search");
        expect(JSON.parse(String(init.body))).toEqual({ q: "train timetable", num: 5 });
        expect(results).toEqual([
            { title: "Timetable", url: "https://example.com/t", snippet: "Trains." },
        ]);
    });

    it("throws on a vendor error, naming only the status", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const fetchImpl = vi.fn(async () =>
            jsonResponse({ error: "key exa-test is over quota" }, 429)
        );
        await expect(searchWeb("q", { fetchImpl })).rejects.toThrow(
            /^Exa search failed \(HTTP 429\)$/
        );
    });

    it("throws when no provider is configured", async () => {
        await expect(searchWeb("q", { fetchImpl: vi.fn() })).rejects.toThrow(
            /No web search provider is configured/
        );
    });
});
