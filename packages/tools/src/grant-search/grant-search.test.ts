import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    buildSearchBody,
    findGrants,
    keywordPhrase,
    opportunityUrl,
    parseOpportunityDetail,
    parseSearchResponse,
    plainText,
    resetGrantSearchCache,
    toIsoDay,
    webQueriesFor,
    webResultToOpportunity,
    type GrantSearchQuery,
} from "./index";

function urlOf(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    return input instanceof URL ? input.href : input.url;
}

/** Trimmed from a real `search2` answer, spring 2026. */
const SEARCH = {
    errorcode: 0,
    msg: "Success",
    data: {
        hitCount: 2,
        startRecord: 0,
        oppHits: [
            {
                id: 360012,
                number: "EPA-R9-SFUND-26-01",
                title: "Environmental Justice Community Grants",
                agencyCode: "EPA",
                agency: "Environmental Protection Agency",
                openDate: "03/14/2026",
                closeDate: "06/30/2026",
                oppStatus: "posted",
                docType: "synopsis",
                alnist: ["66.604"],
            },
            {
                id: 360013,
                number: "ED-GRANTS-041526-001",
                title: "Literacy Innovation Program",
                agencyCode: "ED",
                agency: "Department of Education",
                openDate: "04/15/2026",
                closeDate: "01/01/2026",
                oppStatus: "posted",
                docType: "synopsis",
                alnist: ["84.215"],
            },
        ],
    },
};

const DETAIL = {
    data: {
        id: 360012,
        opportunityTitle: "Environmental Justice Community Grants",
        agencyDetails: { agencyName: "Environmental Protection Agency, Region 9" },
        synopsis: {
            synopsisDesc:
                "<p>Supports community-led projects that reduce pollution&nbsp;exposure.</p><p>Awards run for two years.</p>",
            awardCeiling: "150000",
            awardFloor: "25000",
            applicantEligibilityDesc: "Nonprofit organizations with 501(c)(3) status.",
            responseDate: "06/30/2026",
        },
    },
};

const NOW = new Date("2026-04-20T00:00:00Z");

beforeEach(() => resetGrantSearchCache());

describe("query", () => {
    it("joins comma-separated keywords into one phrase and strips operators", () => {
        expect(keywordPhrase(['youth literacy, "after school"', "x"])).toBe(
            "youth literacy after school"
        );
    });

    it("sends the applicant's eligibility codes and both open statuses by default", () => {
        const body = buildSearchBody({ keywords: ["climate"], applicantType: "nonprofit" });
        expect(body.oppStatuses).toBe("forecasted|posted");
        expect(body.eligibilities).toBe("12|13|25|99");
        expect(body.rows).toBe(20);
        expect(buildSearchBody({ keywords: [], status: "posted", limit: 500 }).rows).toBe(50);
        expect(buildSearchBody({ keywords: [] }).eligibilities).toBe("");
    });

    it("plans web queries that ask for listings, not advice", () => {
        const queries = webQueriesFor({
            keywords: ["youth literacy"],
            applicantType: "nonprofit",
            geography: "Oregon",
        });
        expect(queries).toHaveLength(3);
        expect(queries[0]).toContain("youth literacy grant program nonprofit Oregon");
        expect(webQueriesFor({ keywords: [] })).toEqual([]);
    });
});

describe("parsing", () => {
    it("reads US dates and passes ISO through", () => {
        expect(toIsoDay("03/14/2026")).toBe("2026-03-14");
        expect(toIsoDay("2026-03-14T00:00:00Z")).toBe("2026-03-14");
        expect(toIsoDay("")).toBeNull();
        expect(toIsoDay("not a date")).toBeNull();
    });

    it("turns search hits into opportunities and marks past deadlines closed", () => {
        const { total, hits } = parseSearchResponse(SEARCH, NOW);
        expect(total).toBe(2);
        expect(hits[0]).toMatchObject({
            source: "grants_gov",
            externalId: "360012",
            funder: "Environmental Protection Agency",
            opensOn: "2026-03-14",
            closesOn: "2026-06-30",
            status: "posted",
            categories: ["66.604"],
            opportunityNumber: "EPA-R9-SFUND-26-01",
            url: opportunityUrl("360012"),
        });
        expect(hits[1]!.status).toBe("closed");
    });

    it("merges the synopsis: amounts, eligibility, plain-text description", () => {
        const [hit] = parseSearchResponse(SEARCH, NOW).hits;
        const merged = parseOpportunityDetail(DETAIL, hit!);
        expect(merged.amountMin).toBe(25_000);
        expect(merged.amountMax).toBe(150_000);
        expect(merged.funder).toBe("Environmental Protection Agency, Region 9");
        expect(merged.eligibility).toBe("Nonprofit organizations with 501(c)(3) status.");
        expect(merged.summary).toBe(
            "Supports community-led projects that reduce pollution exposure.\nAwards run for two years."
        );
        expect(parseOpportunityDetail({ nothing: true }, hit!)).toEqual(hit);
    });

    it("strips markup and caps long text", () => {
        expect(plainText("<b>Hi</b> &amp; bye")).toBe("Hi & bye");
        expect(plainText("x".repeat(50), 10)).toHaveLength(10);
        expect(plainText("")).toBeNull();
    });

    it("keeps only web results that look like listings", () => {
        expect(
            webResultToOpportunity({
                url: "https://example.org/blog/how-to-write",
                title: "How to write a proposal",
                content: "Tips for writing.",
                score: 1,
            })
        ).toBeNull();
        const listing = webResultToOpportunity({
            url: "https://www.meyerfoundation.org/apply",
            title: "Community Grants | Meyer Memorial Trust",
            content: "The foundation accepts grant applications from Oregon nonprofits.",
            score: 1,
        });
        expect(listing).toMatchObject({
            source: "web",
            funder: "Meyer Memorial Trust",
            status: "unknown",
        });
    });
});

describe("findGrants", () => {
    it("merges Grants.gov and the web, reads synopses, and reports both sources", async () => {
        const calls: string[] = [];
        const fetchImpl: typeof fetch = async (input, init) => {
            const url = urlOf(input);
            calls.push(url);
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
                string,
                unknown
            >;
            if (url.endsWith("/search2")) {
                expect(body.keyword).toBe("environmental justice");
                return new Response(JSON.stringify(SEARCH), { status: 200 });
            }
            if (url.endsWith("/fetchOpportunity")) {
                expect(body.opportunityId).toBe(360012);
                return new Response(JSON.stringify(DETAIL), { status: 200 });
            }
            return new Response("nope", { status: 404 });
        };
        const result = await findGrants(
            { keywords: ["environmental justice"], applicantType: "nonprofit", limit: 10 },
            {
                fetchImpl,
                grantsGovApiUrl: "https://gg.test/v1/api",
                now: NOW,
                searchWeb: async queries => {
                    expect(queries.length).toBe(3);
                    return [
                        {
                            url: "https://www.meyerfoundation.org/apply",
                            title: "Community Grants | Meyer Memorial Trust",
                            content: "Grant applications from Oregon nonprofits.",
                            score: 1,
                        },
                        {
                            url: "https://example.org/blog",
                            title: "A blog post",
                            content: "Nothing to do with money.",
                            score: 1,
                        },
                    ];
                },
            }
        );
        // The closed hit is dropped before any synopsis read.
        expect(calls.filter(c => c.endsWith("/fetchOpportunity"))).toHaveLength(1);
        expect(result.opportunities.map(o => o.source)).toEqual(["grants_gov", "web"]);
        expect(result.opportunities[0]!.amountMax).toBe(150_000);
        expect(result.sources).toEqual([
            { id: "grants_gov", status: "ok", found: 1, detail: "2 matched" },
            { id: "web", status: "ok", found: 1, detail: null },
        ]);
    });

    it("reports a failing source instead of failing the search", async () => {
        const fetchImpl: typeof fetch = async () => new Response("down", { status: 503 });
        const result = await findGrants(
            { keywords: ["anything"], includeWeb: false },
            { fetchImpl, grantsGovApiUrl: "https://gg.test/v1/api", searchWeb: null }
        );
        expect(result.opportunities).toEqual([]);
        expect(result.sources[0]).toMatchObject({ id: "grants_gov", status: "failed" });
        expect(result.sources[1]).toMatchObject({ id: "web", status: "off", detail: "skipped" });
    });
});

describe("findGrants web search", () => {
    beforeEach(() => {
        vi.stubEnv("EXA_API_KEY", "");
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("SEARCH_PROVIDER", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    const query: GrantSearchQuery = { keywords: ["youth literacy"], includeGrantsGov: false };

    it("searches the whole web on Exa by default, not news", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl: typeof fetch = async (input, init) => {
            expect(urlOf(input)).toBe("https://api.exa.ai/search");
            expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("exa-test");
            bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
            return new Response(
                JSON.stringify({
                    results: [
                        {
                            title: "Literacy Grants | Reading Fund",
                            url: "https://readingfund.example/grants",
                            text: "The foundation funds youth literacy nonprofits.",
                        },
                    ],
                }),
                { status: 200 }
            );
        };

        const result = await findGrants(query, { fetchImpl });

        expect(bodies).toHaveLength(3);
        for (const body of bodies) {
            expect(body).not.toHaveProperty("category");
            expect(body.query).toContain("youth literacy");
        }
        // Three queries found the same page; it is listed once.
        expect(result.opportunities).toHaveLength(1);
        expect(result.opportunities[0]).toMatchObject({
            source: "web",
            url: "https://readingfund.example/grants",
            funder: "Reading Fund",
        });
        expect(result.sources).toContainEqual({ id: "web", status: "ok", found: 1, detail: null });
    });

    it("reports the web source failed when every query fails", async () => {
        vi.stubEnv("EXA_API_KEY", "exa-test");
        const fetchImpl: typeof fetch = async () => new Response("no", { status: 401 });

        const result = await findGrants(query, { fetchImpl });

        expect(result.sources).toContainEqual({
            id: "web",
            status: "failed",
            found: 0,
            detail: "Exa search failed (HTTP 401)",
        });
    });

    it("leaves the web off without a search key", async () => {
        const fetchImpl = vi.fn<typeof fetch>();

        const result = await findGrants(query, { fetchImpl });

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(result.opportunities).toEqual([]);
        expect(result.sources).toContainEqual({
            id: "web",
            status: "off",
            found: 0,
            detail: "no search key",
        });
    });
});
