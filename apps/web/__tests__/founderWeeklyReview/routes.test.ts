jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("~/server/founder-weekly-review/actor-resolver", () => ({
    productionFounderWeeklyReviewActorResolver: { resolve: jest.fn() },
}));
jest.mock("~/server/founder-weekly-review/dispatch-service", () => ({
    createRunWithDispatch: jest.fn(),
}));

import { createFounderWeeklyReviewPostHandler } from "~/app/api/founder-weekly-reviews/route";
import type { FounderWeeklyReviewRunRecord } from "@launchstack/features/founder-weekly-review";
import { auth } from "@clerk/nextjs/server";
const mockAuth = auth as unknown as jest.Mock;

const run = (id = "fwr_1"): FounderWeeklyReviewRunRecord => ({
    id, companyId: 1n, requestKey: "key", reportingPeriod: { start: "2026-07-06", end: "2026-07-12" }, status: "queued", reviewPayload: null,
    reviewSchemaVersion: "founder-weekly-review/v1", evidenceSnapshot: { schemaVersion: "founder-weekly-review-evidence/v1", capturedAt: "2026-07-13T00:00:00.000Z", reportingPeriod: { start: "2026-07-06", end: "2026-07-12" }, workspaceTimezone: "UTC", items: [], sourceWarnings: [] }, evidenceSchemaVersion: "founder-weekly-review-evidence/v1", modelMetadata: null, createdByActorId: "user:u", retryCount: 0, failureSequence: 0, generationAttempt: 0, generationClaimId: null, generationJobId: null, queuedAt: new Date(), claimedAt: null, generationStartedAt: null, generatedAt: null, publishedAt: null, errorCode: null, errorMessage: null, createdAt: new Date(), updatedAt: null,
});
const body = { requestKey: "key", reportingPeriod: { start: "2026-07-06", end: "2026-07-12" }, workspaceTimezone: "UTC", founderContext: "Context" };
function setup(overrides: Partial<Parameters<typeof createFounderWeeklyReviewPostHandler>[0]> = {}) {
    const collector = { collectFounderWeeklyReviewEvidence: jest.fn().mockResolvedValue(run().evidenceSnapshot) };
    const createRunWithDispatch = jest.fn().mockResolvedValue({ run: run(), dispatch: {}, created: true });
    const deps = { actorResolver: { resolve: jest.fn().mockResolvedValue({ externalUserId: "u", internalUserId: 1n, companyId: 1n, role: "owner" }) }, evidenceCollector: collector, repository: { getByCompanyAndRequestKey: jest.fn().mockResolvedValue(null) }, createRunWithDispatch, sendDispatchRequested: jest.fn().mockResolvedValue(undefined), recordRunCreated: jest.fn(), ...overrides } as Parameters<typeof createFounderWeeklyReviewPostHandler>[0];
    return { deps, collector, createRunWithDispatch, handler: createFounderWeeklyReviewPostHandler(deps) };
}
describe("Founder Weekly Review create route", () => {
    beforeEach(() => mockAuth.mockResolvedValue({ userId: "u" }));
    it("returns 401 without auth and never resolves or collects", async () => {
        mockAuth.mockResolvedValue({ userId: null }); const { handler, collector, deps } = setup();
        expect((await handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }))).status).toBe(401);
        expect(deps.actorResolver.resolve).not.toHaveBeenCalled(); expect(collector.collectFounderWeeklyReviewEvidence).not.toHaveBeenCalled();
    });
    it("authorizes before validation and never collects rejected requests", async () => {
        const { handler, collector, createRunWithDispatch } = setup({ actorResolver: { resolve: jest.fn().mockRejectedValue({ code: "forbidden" }) } });
        expect((await handler(new Request("http://test", { method: "POST", body: "{" }))).status).toBe(403);
        expect(collector.collectFounderWeeklyReviewEvidence).not.toHaveBeenCalled(); expect(createRunWithDispatch).not.toHaveBeenCalled();
    });
    it("returns existing company-scoped run before collection and does not record creation", async () => {
        const existing = run("existing"); const { handler, collector, createRunWithDispatch, deps } = setup({ repository: { getByCompanyAndRequestKey: jest.fn().mockResolvedValue(existing) } });
        const response = await handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));
        expect(response.status).toBe(202); expect((await response.json()).run.id).toBe("existing"); expect(collector.collectFounderWeeklyReviewEvidence).not.toHaveBeenCalled(); expect(createRunWithDispatch).not.toHaveBeenCalled(); expect(deps.recordRunCreated).not.toHaveBeenCalled();
    });
    it("persists durable collection inputs, creates a queued run, and records exactly one creation", async () => {
        const { handler, collector, createRunWithDispatch, deps } = setup();
        expect((await handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }))).status).toBe(202);
        expect(collector.collectFounderWeeklyReviewEvidence).not.toHaveBeenCalled();
        expect(createRunWithDispatch).toHaveBeenCalledWith(expect.objectContaining({ requestKey: "key", reportingPeriod: body.reportingPeriod, collectionInput: { workspaceTimezone: "UTC", founderContext: "Context", actorExternalUserId: "u" } }));
        expect(createRunWithDispatch).toHaveBeenCalledTimes(1); expect(deps.recordRunCreated).toHaveBeenCalledTimes(1);
    });
    it("does not synchronously collect evidence", async () => {
        const { handler, createRunWithDispatch, deps } = setup({ evidenceCollector: { collectFounderWeeklyReviewEvidence: jest.fn().mockRejectedValue(new Error("nope")) } });
        expect((await handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }))).status).toBe(202); expect(createRunWithDispatch).toHaveBeenCalledTimes(1); expect(deps.recordRunCreated).toHaveBeenCalledTimes(1);
    });
});
