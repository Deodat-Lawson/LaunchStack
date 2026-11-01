import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    companySearchAvailable,
    configuredWebSearchProvider,
    describeCompanies,
    searchCompanies,
    searchWeb,
} from "./web-search";

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
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
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
        expect(JSON.parse(init.body as string)).toEqual({ q: "train timetable", num: 5 });
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

describe("searchCompanies", () => {
    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("needs an Exa key; Serper alone does not do company search", async () => {
        vi.stubEnv("SERPER_API_KEY", "serper-test");
        expect(companySearchAvailable()).toBe(false);
        await expect(searchCompanies("produce wholesalers in Houston")).rejects.toThrow(
            "Company search needs an Exa key"
        );
    });

    it("asks Exa's company index in the country, never for excluded hosts", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        expect(companySearchAvailable()).toBe(true);
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: [
                    {
                        title: "Brothers Produce | Houston Produce Distributor",
                        url: "https://www.brothersproduce.com/",
                        text: "Fresh fruit and vegetables for Houston restaurants since 1980.",
                    },
                    // The same company again, and a host on the exclusion list.
                    { title: "Brothers Produce — About", url: "https://brothersproduce.com/about" },
                    { title: "Existing customer", url: "https://customer.example/" },
                    { title: "No URL" },
                ],
            })
        );

        const hits = await searchCompanies("produce wholesalers in Houston", {
            country: "us",
            excludeDomains: ["www.Customer.example", "customer.example", " "],
            fetchImpl,
        });

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.exa.ai/search");
        expect((init.headers as Record<string, string>)["x-api-key"]).toBe("exa-test");
        expect(JSON.parse(init.body as string)).toEqual({
            query: "produce wholesalers in Houston",
            type: "auto",
            category: "company",
            numResults: 10,
            userLocation: "US",
            excludeDomains: ["customer.example"],
            contents: { text: { maxCharacters: 600 } },
        });
        expect(hits).toEqual([
            {
                title: "Brothers Produce | Houston Produce Distributor",
                url: "https://www.brothersproduce.com/",
                domain: "brothersproduce.com",
                description: "Fresh fruit and vegetables for Houston restaurants since 1980.",
            },
        ]);
    });

    it("caps the count at 25 and leaves out a malformed country", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
        await searchCompanies("roasters", { maxResults: 80, country: "Netherlands", fetchImpl });
        const body = JSON.parse(
            (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
        );
        expect(body.numResults).toBe(25);
        expect(body).not.toHaveProperty("userLocation");
        expect(body).not.toHaveProperty("excludeDomains");
    });

    it("throws on a vendor error, naming only the status", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const fetchImpl = vi.fn(async () => jsonResponse({ error: "secret detail" }, 402));
        await expect(searchCompanies("roasters", { fetchImpl })).rejects.toThrow(
            "Exa company search failed (HTTP 402)"
        );
    });
});

describe("describeCompanies", () => {
    beforeEach(() => vi.stubEnv("EXA_API_KEY", "exa-test"));
    afterEach(() => vi.unstubAllEnvs());

    it("reads each homepage once and keeps Exa's summary, or the page start", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: [
                    {
                        url: "https://acme.example/",
                        title: "Acme",
                        summary: "Acme sells point-of-sale software to independent cafés.",
                        text: "Welcome to Acme.",
                    },
                    {
                        url: "https://beta.example/",
                        title: "Beta",
                        text: "Beta roasts coffee for offices.",
                    },
                    { url: "https://empty.example/", title: "Empty" },
                ],
            })
        );

        const described = await describeCompanies(
            [
                "https://acme.example/",
                "https://acme.example/",
                "https://beta.example/",
                "https://empty.example/",
            ],
            { fetchImpl }
        );

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.exa.ai/contents");
        const body = JSON.parse(init.body as string);
        expect(body.urls).toEqual([
            "https://acme.example/",
            "https://beta.example/",
            "https://empty.example/",
        ]);
        expect(body.summary.query).toContain("what does this company sell");
        expect(described).toEqual([
            {
                url: "https://acme.example/",
                domain: "acme.example",
                title: "Acme",
                description: "Acme sells point-of-sale software to independent cafés.",
            },
            {
                url: "https://beta.example/",
                domain: "beta.example",
                title: "Beta",
                description: "Beta roasts coffee for offices.",
            },
        ]);
    });

    it("makes no request for an empty list", async () => {
        const fetchImpl = vi.fn();
        expect(await describeCompanies([], { fetchImpl })).toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
