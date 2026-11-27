import type { HumanMessage, SystemMessage } from "@langchain/core/messages";
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

/** The analyst's standing instructions: the system message of the one call. */
function analystRules(): string {
    const [, messages] = mockInvoke.mock.calls[0]!;
    return (messages[0] as SystemMessage).content as string;
}

const OUR_COMPANY = "## Our company (the only source of facts about us)";
const WEB_RESULTS = "## Web search results (other companies and the market; never facts about us)";

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
        expect(input).toContain(WEB_RESULTS);
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
        expect(analystInput()).toBe(
            `${OUR_COMPANY}\nAcme sells CRM software to dentists.\n\nNo web search results.`
        );
    });
});

/**
 * The search runs on the company's name, so its hits include unrelated
 * companies and products called the same thing. The analyst once read a real
 * "LaunchStack" boilerplate as us and listed its stack under `ourAdvantages`.
 */
describe("analyzeCompetitors and a company that only shares our name", () => {
    const fetchMock = vi.fn<typeof fetch>();
    const NAMESAKE =
        "Integrated backend scaffolding covering Fastify, TypeScript, Prisma, and PostgreSQL.";

    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () =>
            jsonResponse({
                results: [
                    {
                        title: "LaunchStack: the SaaS boilerplate",
                        url: "https://launchstack-boilerplate.example/",
                        text: NAMESAKE,
                    },
                ],
            })
        );
        mockInvoke.mockReset();
        mockInvoke.mockResolvedValue(ANALYSIS);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("shows our company and the web results as two labelled blocks, ours first", async () => {
        await analyzeCompetitors({
            companyName: "LaunchStack Dev",
            categories: ["documents"],
            companyContext:
                "Company: LaunchStack Dev.\nDescription: Makes Harbor, a workspace that answers questions from a startup's own documents.",
        });

        const input = analystInput();
        const ours = input.indexOf(OUR_COMPANY);
        const web = input.indexOf(WEB_RESULTS);
        expect(ours).toBe(0);
        expect(web).toBeGreaterThan(ours);

        // The same-name page sits under the web heading and nowhere in our block.
        expect(input.slice(ours, web)).toContain("Makes Harbor");
        expect(input.slice(ours, web)).not.toContain("Fastify");
        expect(input.indexOf(NAMESAKE)).toBeGreaterThan(web);
    });

    it("says, by name, that a result called the same thing is a different company", async () => {
        await analyzeCompetitors({
            companyName: "LaunchStack Named",
            categories: ["documents"],
            companyContext: "Company: LaunchStack Named.",
        });

        const input = analystInput();
        const note = input.indexOf(
            'A result that mentions "LaunchStack Named", a close variant of that name, or one of our products is about a different company unless it describes the same business as the block above.'
        );
        // Read before the first hit, not after the list.
        expect(note).toBeGreaterThan(input.indexOf(WEB_RESULTS));
        expect(note).toBeLessThan(input.indexOf(NAMESAKE));
    });

    it("tells the analyst that our advantages come from our block, never from a search result", async () => {
        await analyzeCompetitors({
            companyName: "LaunchStack Rules",
            categories: ["documents"],
            companyContext: "Company: LaunchStack Rules.",
        });

        const rules = analystRules();
        expect(rules).toContain("A name is not an identity.");
        expect(rules).toContain(
            "do not use it to describe us, do not credit us with its features, technology, customers or results, and do not list it as a competitor"
        );
        expect(rules).toContain("Nothing in the search results is a fact about us.");
        expect(rules).toMatch(
            /ourAdvantages: .*Each must restate something "Our company" says about us.*Never take one from a search result\. If "Our company" does not support any, return an empty array\./
        );
        // The old wording invited the leak.
        expect(rules).not.toContain("infer from context");
    });

    it("labels our block even when the workspace has no description", async () => {
        await analyzeCompetitors({ companyName: "LaunchStack Bare", categories: [] });

        const input = analystInput();
        const web = input.indexOf(WEB_RESULTS);
        expect(input.slice(0, web)).toBe(
            `${OUR_COMPANY}\nCompany: LaunchStack Bare. Categories: Unknown.\n\n`
        );
    });
});
