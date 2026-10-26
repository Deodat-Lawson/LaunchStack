/** @jest-environment node */
import { NextRequest } from "next/server";
import { VantageError } from "@launchstack/pipelines/vantage";
const mockGate = jest.fn();
const mockService = {
    load: jest.fn(),
    generateWeek: jest.fn(),
    preflight: jest.fn(),
    review: jest.fn(),
    source: jest.fn(),
};
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/server/vantage/demo-service", () => ({
    assertVantageContextDemoEnabled: () => mockGate(),
    createVantageContextDemoService: () => mockService,
}));
import { GET, POST } from "~/app/api/vantage/demo/route";
import { GET as sourceGET } from "~/app/api/vantage/demo/source/route";
import { PATCH } from "~/app/api/vantage/demo/topics/route";
import { POST as preflightPOST } from "~/app/api/vantage/demo/preflight/route";
const reportId = "b8f8813c-b068-422b-9687-d9076a55e80a";
const topicId = "3efc1e8c-f652-473b-8683-09fc0963c46e";
const request = (path: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://localhost:3104/api/vantage/demo${path}`, {
        method,
        ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
describe("local context demo route extension", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGate.mockReset();
        for (const call of Object.values(mockService))
            call.mockResolvedValue({ selectedWeek: "2026-10-12", report: null });
    });
    it("returns404 outside the explicit development gate before invoking services", async () => {
        mockGate.mockImplementation(() => {
            throw new VantageError("Not found.", 404, "not_found");
        });
        expect((await POST(request("", "POST", { weekStart: "2026-10-12" }))).status).toBe(404);
        expect(mockService.generateWeek).not.toHaveBeenCalled();
    });
    it("returns the selected weekly extension and validates the configured week syntax", async () => {
        expect((await GET(request("?week=2026-10-12"))).status).toBe(200);
        expect(mockService.load).toHaveBeenCalledWith("2026-10-12");
        expect((await GET(request("?week=invalid"))).status).toBe(400);
    });
    it("accepts only a week for explicit context generation, never actor or source selectors", async () => {
        expect((await POST(request("", "POST", { weekStart: "2026-10-12" }))).status).toBe(201);
        expect(mockService.generateWeek).toHaveBeenCalledWith("2026-10-12");
        expect(
            (await POST(request("", "POST", { weekStart: "2026-10-12", companyId: "another" })))
                .status
        ).toBe(400);
        expect(mockService.generateWeek).toHaveBeenCalledTimes(1);
    });
    it("keeps the authorized no-provider preflight separate from generation", async () => {
        expect(
            (await preflightPOST(request("/preflight", "POST", { weekStart: "2026-10-12" }))).status
        ).toBe(200);
        expect(mockService.preflight).toHaveBeenCalledWith("2026-10-12");
        expect(mockService.generateWeek).not.toHaveBeenCalled();
    });
    it("forwards exact V0 object references without translating them to V1 citations", async () => {
        const params = new URLSearchParams({
            reportId,
            kind: "doc",
            id: "workspace-document/321",
            version: "456",
        });
        expect((await sourceGET(request(`/source?${params}`))).status).toBe(200);
        expect(mockService.source).toHaveBeenCalledWith(reportId, {
            kind: "doc",
            id: "workspace-document/321",
            version: "456",
        });
        params.set("kind", "document");
        expect((await sourceGET(request(`/source?${params}`))).status).toBe(400);
    });
    it("requires CAS version and a human review; arbitrary action/status fields are rejected", async () => {
        const review = {
            reportId,
            topicId,
            expectedVersion: 2,
            decision: { value: "needs-more-evidence", text: "Compare sample IDs." },
        };
        expect((await PATCH(request("/topics", "PATCH", review))).status).toBe(200);
        expect(mockService.review).toHaveBeenCalledWith(review);
        expect(
            (await PATCH(request("/topics", "PATCH", { ...review, actionStatus: "done" }))).status
        ).toBe(400);
        expect(
            (await PATCH(request("/topics", "PATCH", { reportId, topicId, expectedVersion: 2 })))
                .status
        ).toBe(400);
        expect(
            (await PATCH(request("/topics", "PATCH", { ...review, expectedVersion: 0 }))).status
        ).toBe(400);
    });
    it("preserves safe authorization and stale-version error statuses", async () => {
        mockService.load.mockRejectedValue(new VantageError("Sign in.", 401, "unauthorized"));
        expect((await GET(request(""))).status).toBe(401);
        mockService.review.mockRejectedValue(
            new VantageError("Reload.", 409, "stale_context_review")
        );
        expect(
            (
                await PATCH(
                    request("/topics", "PATCH", {
                        reportId,
                        topicId,
                        expectedVersion: 1,
                        status: "kept",
                    })
                )
            ).status
        ).toBe(409);
    });
    it("reports a validated-model failure as503 without exposing raw provider details", async () => {
        mockService.generateWeek.mockRejectedValue(
            Object.assign(new Error("private-provider-error-marker"), {
                code: "context_model_not_successful",
            })
        );
        const response = await POST(request("", "POST", { weekStart: "2026-10-12" }));
        expect(response.status).toBe(503);
        const body = JSON.stringify(await response.json());
        expect(body).toContain("Your saved report and reviews were preserved");
        expect(body).not.toContain("private-provider-error-marker");
    });
});
