/**
 * Unit tests for Serper adapter (callSerper).
 * Feature: Serper dual-channel search — Task 4.1
 */

const mockFetch = jest.fn();

jest.mock("~/env", () => ({
    env: {
        server: {
            SERPER_API_KEY: "test-serper-key",
        },
    },
}));

beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Must import after mocks so env is mocked
import { callSerper } from "~/lib/tools/trend-search/providers/serper";
import type { RawSearchResult } from "~/lib/tools/trend-search/types";

const SERPER_NEWS_URL = "https://google.serper.dev/news";

function makeOkResponse(body: { news?: unknown[] }) {
    return {
        ok: true,
        text: async () => "",
        json: async () => body,
    } as Response;
}

function makeErrorResponse(status: number, statusText: string, body = "Error") {
    return {
        ok: false,
        status,
        statusText,
        text: async () => body,
        json: async () => {
            throw new Error("not json");
        },
    } as Response;
}

describe("callSerper", () => {
    describe("valid response normalizes correctly to RawSearchResult[]", () => {
        it("maps link→url, title, snippet→content, score, publishedDate", async () => {
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

            const results = await callSerper("AI trends");

            expect(mockFetch).toHaveBeenCalledWith(
                SERPER_NEWS_URL,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "X-API-KEY": "test-serper-key",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ q: "AI trends", num: 10 }),
                })
            );
            expect(results).toHaveLength(1);
            const r = results[0] as RawSearchResult;
            expect(r.url).toBe("https://example.com/1");
            expect(r.title).toBe("AI Trends 2026");
            expect(r.content).toBe("Summary here");
            expect(r.score).toBeDefined();
            expect(typeof r.score).toBe("number");
            expect(r.publishedDate).toBe("2 hours ago");
        });

        it("uses Untitled and empty string when title/snippet missing", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [{ link: "https://example.com/2" }],
                })
            );

            const results = await callSerper("query");

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe("Untitled");
            expect(results[0].content).toBe("");
        });
    });

    describe("missing SERPER_API_KEY returns empty array", () => {
        it("returns [] and does not call fetch when key is undefined", async () => {
            const warnSpy = jest.spyOn(console, "warn").mockImplementation();
            const envModule = await import("~/env");
            const server = envModule.env.server as { SERPER_API_KEY?: string };
            const original = server.SERPER_API_KEY;
            server.SERPER_API_KEY = undefined;

            const results = await callSerper("query");

            expect(results).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
            server.SERPER_API_KEY = original;
            warnSpy.mockRestore();
        });
    });

    describe("non-2xx response throws error", () => {
        it("throws with status and body text on 500", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(500, "Internal Server Error", "Server down"));

            await expect(callSerper("query")).rejects.toThrow(
                /Serper API error: 500 Internal Server Error.*Server down/
            );
        });

        it("throws on 401", async () => {
            mockFetch.mockResolvedValue(makeErrorResponse(401, "Unauthorized", "Invalid key"));

            await expect(callSerper("query")).rejects.toThrow(/Serper API error: 401/);
        });
    });

    describe("empty news array returns empty results", () => {
        it("returns [] when news is empty array", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({ news: [] }));

            const results = await callSerper("query");

            expect(results).toEqual([]);
        });

        it("returns [] when news is missing", async () => {
            mockFetch.mockResolvedValue(makeOkResponse({}));

            const results = await callSerper("query");

            expect(results).toEqual([]);
        });
    });

    describe("positional score calculation is correct", () => {
        it("first item has highest score, last has lowest (score = 1 - position/total)", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://a.com", position: 1 },
                        { link: "https://b.com", position: 2 },
                        { link: "https://c.com", position: 3 },
                    ],
                })
            );

            const results = await callSerper("query");

            expect(results).toHaveLength(3);
            const total = 3;
            expect(results[0].score).toBeCloseTo(1 - 1 / total); // 0.666...
            expect(results[1].score).toBeCloseTo(1 - 2 / total); // 0.333...
            expect(results[2].score).toBeCloseTo(1 - 3 / total); // 0
            expect(results[0].score).toBeGreaterThan(results[1].score);
            expect(results[1].score).toBeGreaterThan(results[2].score);
        });

        it("uses index+1 when position is missing", async () => {
            mockFetch.mockResolvedValue(
                makeOkResponse({
                    news: [
                        { link: "https://a.com" },
                        { link: "https://b.com" },
                    ],
                })
            );

            const results = await callSerper("query");

            expect(results).toHaveLength(2);
            // position 1 and 2 from index+1, total 2 → scores 0.5 and 0
            expect(results[0].score).toBeCloseTo(1 - 1 / 2);
            expect(results[1].score).toBeCloseTo(1 - 2 / 2);
        });
    });
});
