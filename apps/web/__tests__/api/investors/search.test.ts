/**
 * GET /api/investors/search — the Studio's Find investors.
 *
 * Pins that it asks who you are before it asks SEC anything, that only the
 * words, state and window typed reach the search, and that SEC being down
 * reads as SEC being down rather than as no investors.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { standard: {}, strict: {} },
}));

const mockFindInvestors = jest.fn();
jest.mock("@launchstack/tools/investor-search", () => ({
    findInvestors: (...args: unknown[]) => mockFindInvestors(...args),
}));

import { NextRequest } from "next/server";

import { GET } from "~/app/api/investors/search/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

function get(query: string) {
    return GET(new NextRequest(`http://localhost/api/investors/search${query}`));
}

const RESULT = {
    funds: [{ cik: "0002129288", name: "DCVC Energy & Climate II, L.P.", managers: [] }],
    totalFilings: 1,
    singleDealVehiclesHidden: 0,
    source: "sec-edgar-form-d",
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "member" }),
    });
    mockFindInvestors.mockResolvedValue(RESULT);
});

describe("GET /api/investors/search", () => {
    it("asks SEC nothing for someone signed out", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        const res = await get("?q=climate");
        expect(res.status).toBe(401);
        expect(mockFindInvestors).not.toHaveBeenCalled();
    });

    it("lets any member search, and passes what was typed", async () => {
        const res = await get("?q=climate,%20health&state=ca&within=90&limit=10");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(RESULT);

        const [query] = mockFindInvestors.mock.calls[0] as [Record<string, unknown>];
        expect(query).toMatchObject({
            keywords: ["climate, health"],
            state: "ca",
            limit: 10,
            includeSingleDealVehicles: false,
        });
        const since = Date.parse(query.since as string);
        const ninetyDaysAgo = Date.now() - 90 * 24 * 3600_000;
        expect(Math.abs(since - ninetyDaysAgo)).toBeLessThan(2 * 24 * 3600_000);
    });

    it("defaults to a year, twenty funds and no single-deal vehicles", async () => {
        await get("?q=&state=");
        const [query] = mockFindInvestors.mock.calls[0] as [Record<string, unknown>];
        expect(query).toMatchObject({ keywords: [], limit: 20, includeSingleDealVehicles: false });
        expect(query.state).toBeUndefined();
    });

    it("includes single-deal vehicles when asked", async () => {
        await get("?spvs=1");
        const [query] = mockFindInvestors.mock.calls[0] as [Record<string, unknown>];
        expect(query.includeSingleDealVehicles).toBe(true);
    });

    it.each([
        ["a state that is not a code", "?state=California"],
        ["a window it does not offer", "?within=7"],
        ["too many funds", "?limit=500"],
    ])("refuses %s", async (_label, query) => {
        const res = await get(query);
        expect(res.status).toBe(400);
        expect(mockFindInvestors).not.toHaveBeenCalled();
    });

    it("says SEC did not answer, rather than that there are no investors", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockFindInvestors.mockRejectedValue(new Error("SEC EDGAR 500 for /LATEST/search-index"));
        const res = await get("?q=climate");
        expect(res.status).toBe(502);
        expect((await res.json()) as { error: string }).toEqual({
            error: "SEC EDGAR did not answer. Try again in a moment.",
        });
        spy.mockRestore();
    });
});
