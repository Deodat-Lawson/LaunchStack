/**
 * `/api/usage/*`, the routes: what each reads from the query string and hands
 * the service, which queries are a 400, a service's 404 passes through, and
 * `/me` needs no `analytics.view`. The 403s for members on the workspace-wide
 * routes live in permission-gates.test.ts; the numbers in the server tests.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as UsageParams from "~/server/usage/params";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockSummary = jest.fn();
const mockPeople = jest.fn();
const mockActivity = jest.fn();
const mockDocuments = jest.fn();
const mockMe = jest.fn();
jest.mock("~/server/usage", () => {
    const params = jest.requireActual<typeof UsageParams>("~/server/usage/params");
    return {
        readUsageQuery: params.readUsageQuery,
        DOCUMENTS_PAGE: params.DOCUMENTS_PAGE,
        usageSummary: (...args: unknown[]) => mockSummary(...args),
        usagePeople: (...args: unknown[]) => mockPeople(...args),
        usageActivity: (...args: unknown[]) => mockActivity(...args),
        usageDocuments: (...args: unknown[]) => mockDocuments(...args),
        usageMe: (...args: unknown[]) => mockMe(...args),
    };
});

import { GET as activity } from "~/app/api/usage/activity/route";
import { GET as documents } from "~/app/api/usage/documents/route";
import { GET as me } from "~/app/api/usage/me/route";
import { GET as people } from "~/app/api/usage/people/route";
import { GET as summary } from "~/app/api/usage/summary/route";
import { copy } from "~/i18n/copy";
import { notFound } from "~/server/workspace/errors";

const get = (path: string) => new Request(`http://localhost${path}`);

function signedInAs(role: string) {
    const ctx = makeWorkspaceContext({ role });
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: ctx });
    return ctx;
}

beforeEach(() => {
    jest.clearAllMocks();
    for (const mock of [mockSummary, mockPeople, mockActivity, mockDocuments, mockMe]) {
        mock.mockResolvedValue({ ok: true });
    }
});

describe("GET /api/usage/summary", () => {
    it("reads a preset window and no filter by default", async () => {
        const ctx = signedInAs("admin");
        const response = await summary(get("/api/usage/summary"));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        const [passedCtx, window, filter] = mockSummary.mock.calls[0];
        expect(passedCtx).toBe(ctx);
        expect(window).toMatchObject({ days: 30 });
        expect(filter).toMatchObject({ person: null, group: null });
    });

    it("hands over a custom range and one person", async () => {
        signedInAs("owner");
        await summary(get("/api/usage/summary?from=2026-01-01&to=2026-01-31&person=12"));
        const [, window, filter] = mockSummary.mock.calls[0];
        expect(window).toEqual({
            from: "2026-01-01",
            to: "2026-01-31",
            days: 31,
            previousFrom: "2025-12-01",
            previousTo: "2025-12-31",
        });
        expect(filter).toMatchObject({ person: 12, group: null });
    });

    it.each([
        ["/api/usage/summary?days=0"],
        ["/api/usage/summary?days=abc"],
        ["/api/usage/summary?from=2026-01-05"],
        ["/api/usage/summary?from=2026-02-31&to=2026-03-01"],
        ["/api/usage/summary?from=2099-01-01&to=2099-01-02"],
        ["/api/usage/summary?person=abc"],
        ["/api/usage/summary?group=-3"],
        ["/api/usage/summary?person=1&group=2"],
    ])("refuses %s with a 400", async path => {
        signedInAs("admin");
        const response = await summary(get(path));
        expect(response.status).toBe(400);
        const body = (await response.json()) as { error?: string };
        expect(typeof body.error).toBe("string");
        expect(mockSummary).not.toHaveBeenCalled();
    });

    it("passes a service 404 through", async () => {
        signedInAs("admin");
        mockSummary.mockRejectedValue(notFound(copy("team.server.errors.memberNotFound")));
        const response = await summary(get("/api/usage/summary?person=999"));
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: "Member not found." });
    });

    it("answers anything else with a logged 500", async () => {
        signedInAs("admin");
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        mockSummary.mockRejectedValue(new Error("boom"));
        const response = await summary(get("/api/usage/summary"));
        expect(response.status).toBe(500);
        spy.mockRestore();
    });

    it("answers whatever the auth guard answers", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        expect((await summary(get("/api/usage/summary"))).status).toBe(401);
    });
});

describe("GET /api/usage/people", () => {
    it("hands over the group filter only", async () => {
        signedInAs("admin");
        const response = await people(get("/api/usage/people?days=7&group=4&person=2"));
        expect(response.status).toBe(400); // person and group together
        await people(get("/api/usage/people?days=7&group=4"));
        const [, window, filter] = mockPeople.mock.calls[0];
        expect(window).toMatchObject({ days: 7 });
        expect(filter).toEqual({ group: 4 });
    });
});

describe("GET /api/usage/activity", () => {
    it("pages 100 rows from the start by default", async () => {
        signedInAs("admin");
        await activity(get("/api/usage/activity"));
        expect(mockActivity.mock.calls[0][2]).toMatchObject({
            person: null,
            feature: null,
            offset: 0,
            limit: 100,
        });
    });

    it("hands over a person, a feature and a page", async () => {
        signedInAs("admin");
        await activity(get("/api/usage/activity?person=3&feature=notes&offset=200&limit=500"));
        expect(mockActivity.mock.calls[0][2]).toMatchObject({
            person: 3,
            feature: "notes",
            offset: 200,
            limit: 500,
        });
    });

    it.each([["feature=gpt-5"], ["limit=501"], ["limit=0"], ["offset=-1"], ["offset=1.5"]])(
        "refuses %s with a 400",
        async query => {
            signedInAs("admin");
            const response = await activity(get(`/api/usage/activity?${query}`));
            expect(response.status).toBe(400);
            expect(mockActivity).not.toHaveBeenCalled();
        }
    );
});

describe("GET /api/usage/documents", () => {
    it("lists 200 documents by default and at most 1,000", async () => {
        signedInAs("admin");
        await documents(get("/api/usage/documents"));
        expect(mockDocuments.mock.calls[0][2]).toEqual({ limit: 200 });
        await documents(get("/api/usage/documents?limit=1000"));
        expect(mockDocuments.mock.calls[1][2]).toEqual({ limit: 1000 });
        expect((await documents(get("/api/usage/documents?limit=1001"))).status).toBe(400);
    });
});

describe("GET /api/usage/me", () => {
    it.each([["member"], ["viewer"]])("answers a %s, who has no analytics.view", async role => {
        const ctx = signedInAs(role);
        expect(ctx.can("analytics.view")).toBe(false);
        const response = await me(get("/api/usage/me?days=90"));
        expect(response.status).toBe(200);
        const [passedCtx, window] = mockMe.mock.calls[0];
        expect(passedCtx).toBe(ctx);
        expect(window).toMatchObject({ days: 90 });
    });

    it("refuses a bad window", async () => {
        signedInAs("member");
        expect((await me(get("/api/usage/me?days=367"))).status).toBe(400);
    });
});
