import type { HumanMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./models", () => ({ invokeMarketingStructured: vi.fn() }));

import { analyzeCompetitors } from "./competitor";
import { invokeMarketingStructured } from "./models";
import type { CompetitorAnalysis } from "./types";

const ANALYSIS: CompetitorAnalysis = {
    competitors: [],
    ourAdvantages: [],
    marketGaps: [],
    messagingAntiPatterns: [],
};

const mockInvoke = vi.mocked(invokeMarketingStructured);

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/** What the analyst model was shown: the human message of the one call. */
function analystInput(): string {
    const [, messages] = mockInvoke.mock.calls[0]!;
    // analyzeCompetitors sends the context as one string.
    return (messages[1] as HumanMessage).content as string;
}

describe("analyzeCompetitors web search", () => {
    const fetchMock = vi.fn<typeof fetch>();

    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        mockInvoke.mockReset();
        mockInvoke.mockResolvedValue(ANALYSIS);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("searches the whole web on Exa, not news, and shows the analyst the hits", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        fetchMock.mockImplementation(async () =>
            jsonResponse({
                results: [
                    {
                        title: "Rivalsoft — CRM for clinics",
                        url: "https://rivalsoft.example/",
                        text: "Rivalsoft sells scheduling and CRM to dental clinics.",
                    },
                ],
            })
        );

        await analyzeCompetitors({
            companyName: "Acme Exa",
            categories: ["crm"],
            companyContext: "Acme sells CRM software to dentists.",
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        for (const [url, init] of fetchMock.mock.calls) {
            expect(url).toBe("https://api.exa.ai/search");
            const body = JSON.parse(init!.body as string) as Record<string, unknown>;
            expect(body).not.toHaveProperty("category");
            expect(body.type).toBe("auto");
        }
        const queries = fetchMock.mock.calls.map(
            ([, init]) => (JSON.parse(init!.body as string) as { query: string }).query
        );
        expect(queries[0]).toContain('"Acme Exa"');
        expect(queries[0]).toContain("competitors");
        // Both queries returned the same page; the analyst sees it once.
        const input = analystInput();
        expect(input).toContain("Web search results (competitors / market):");
        expect(input.match(/https:\/\/rivalsoft\.example\//g)).toHaveLength(1);
    });

    it("keeps one query's hits when the other fails", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        fetchMock
            .mockImplementationOnce(async () => jsonResponse({ error: "busy" }, 503))
            .mockImplementationOnce(async () =>
                jsonResponse({
                    results: [{ title: "Leader", url: "https://leader.example/", text: "CRM." }],
                })
            );

        await analyzeCompetitors({ companyName: "Acme Partial", categories: ["crm"] });

        expect(analystInput()).toContain("https://leader.example/");
    });

    it("runs on the company context alone without a search key", async () => {
        await analyzeCompetitors({
            companyName: "Acme Keyless",
            categories: ["crm"],
            companyContext: "Acme sells CRM software to dentists.",
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(analystInput()).toBe("Acme sells CRM software to dentists.");
    });
});
