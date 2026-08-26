jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("~/server/founder-weekly-review/actor-resolver", () => ({
    productionFounderWeeklyReviewActorResolver: { resolve: jest.fn() },
}));
jest.mock("~/server/founder-weekly-review/dispatch-service", () => ({
    retryRunWithDispatch: jest.fn(),
}));
import { auth } from "@clerk/nextjs/server";
import { createFounderWeeklyReviewGetHandler } from "~/app/api/founder-weekly-reviews/[runId]/get-handler";
import { createFounderWeeklyReviewRetryPostHandler } from "~/app/api/founder-weekly-reviews/[runId]/retry/retry-handler";
import {
    FounderWeeklyReviewForbiddenError,
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
    type FounderWeeklyReviewRunRecord,
} from "@launchstack/pipelines/founder-weekly-review";
const mockAuth = auth as unknown as jest.Mock;
const actor = { externalUserId: "u", internalUserId: 1n, companyId: 1n, role: "owner" as const };
function run(
    status: FounderWeeklyReviewRunRecord["status"] = "queued"
): FounderWeeklyReviewRunRecord {
    return {
        id: "fwr_1",
        companyId: 1n,
        requestKey: "key",
        reportingPeriod: { start: "2026-07-06", end: "2026-07-12" },
        status,
        reviewPayload:
            status === "draft"
                ? ({ schemaVersion: "founder-weekly-review/v2", sections: {} } as never)
                : null,
        reviewSchemaVersion: "founder-weekly-review/v1",
        evidenceSnapshot: {
            schemaVersion: "founder-weekly-review-evidence/v1",
            capturedAt: "2026-07-13T00:00:00.000Z",
            reportingPeriod: { start: "2026-07-06", end: "2026-07-12" },
            workspaceTimezone: "UTC",
            items: [
                {
                    sourceType: "founder_context",
                    sourceId: "secret",
                    title: "Founder context",
                    excerpt: "DO NOT LEAK",
                    metadata: {},
                },
            ],
            sourceWarnings: [],
        },
        evidenceSchemaVersion: "founder-weekly-review-evidence/v1",
        modelMetadata: null,
        createdByActorId: "user:u",
        retryCount: 0,
        failureSequence: 0,
        generationAttempt: 0,
        generationClaimId: null,
        generationJobId: null,
        queuedAt: new Date(),
        claimedAt: null,
        generationStartedAt: null,
        generatedAt: null,
        publishedAt: null,
        errorCode: "safe_code",
        errorMessage: "provider secret",
        createdAt: new Date(),
        updatedAt: null,
    };
}
describe("Founder Weekly Review read and retry route handlers", () => {
    beforeEach(() => mockAuth.mockResolvedValue({ userId: "u" }));
    it("read authenticates before lookup and returns safe status payloads", async () => {
        const getRun = jest.fn().mockResolvedValue(run("failed"));
        const handler = createFounderWeeklyReviewGetHandler({
            actorResolver: { resolve: jest.fn().mockResolvedValue(actor) },
            getRun,
        });
        const response = await handler(new Request("http://test"), {
            params: Promise.resolve({ runId: "fwr_1" }),
        });
        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.data.run.status).toBe("failed");
        expect(JSON.stringify(json)).not.toContain("DO NOT LEAK");
        expect(JSON.stringify(json)).not.toContain("provider secret");
    });
    it("read returns 401 without lookup and maps company-scoped absence to 404", async () => {
        mockAuth.mockResolvedValue({ userId: null });
        const getRun = jest.fn();
        const handler = createFounderWeeklyReviewGetHandler({
            actorResolver: { resolve: jest.fn() },
            getRun,
        });
        expect(
            (await handler(new Request("http://test"), { params: Promise.resolve({ runId: "x" }) }))
                .status
        ).toBe(401);
        expect(getRun).not.toHaveBeenCalled();
        mockAuth.mockResolvedValue({ userId: "u" });
        const missing = createFounderWeeklyReviewGetHandler({
            actorResolver: { resolve: jest.fn().mockResolvedValue(actor) },
            getRun: jest.fn().mockRejectedValue(new FounderWeeklyReviewNotFoundError("x")),
        });
        expect(
            (await missing(new Request("http://test"), { params: Promise.resolve({ runId: "x" }) }))
                .status
        ).toBe(404);
    });
    it.each(["queued", "generating", "draft", "failed", "published"] as const)(
        "returns the %s status without snapshot internals",
        async status => {
            const handler = createFounderWeeklyReviewGetHandler({
                actorResolver: { resolve: jest.fn().mockResolvedValue(actor) },
                getRun: jest.fn().mockResolvedValue(run(status)),
            });
            const json = await (
                await handler(new Request("http://test"), {
                    params: Promise.resolve({ runId: "fwr_1" }),
                })
            ).json();
            expect(json.data.run).toMatchObject({ id: "fwr_1", status });
            expect(json.data.run).not.toHaveProperty("evidenceSnapshot");
            expect(JSON.stringify(json)).not.toContain("DO NOT LEAK");
        }
    );
    it("does not look up a run when strict actor resolution fails", async () => {
        const getRun = jest.fn();
        const handler = createFounderWeeklyReviewGetHandler({
            actorResolver: {
                resolve: jest.fn().mockRejectedValue(new FounderWeeklyReviewForbiddenError()),
            },
            getRun,
        });
        expect(
            (
                await handler(new Request("http://test"), {
                    params: Promise.resolve({ runId: "fwr_1" }),
                })
            ).status
        ).toBe(403);
        expect(getRun).not.toHaveBeenCalled();
    });
    it("retry increments only an applied transition and does not notify rejected callers", async () => {
        const incrementRetry = jest.fn(),
            sendDispatchRequested = jest.fn().mockResolvedValue(undefined);
        const retryRunWithDispatch = jest
            .fn()
            .mockResolvedValue({ run: run("queued"), dispatch: {}, transitionApplied: true });
        const handler = createFounderWeeklyReviewRetryPostHandler({
            actorResolver: { resolve: jest.fn().mockResolvedValue(actor) },
            retryRunWithDispatch,
            incrementRetry,
            sendDispatchRequested,
        });
        expect(
            (
                await handler(
                    new Request("http://test", {
                        method: "POST",
                        body: JSON.stringify({ requestKey: "r1" }),
                    }),
                    { params: Promise.resolve({ runId: "fwr_1" }) }
                )
            ).status
        ).toBe(202);
        expect(incrementRetry).toHaveBeenCalledTimes(1);
        expect(sendDispatchRequested).toHaveBeenCalledTimes(1);
        retryRunWithDispatch.mockResolvedValue({
            run: run("queued"),
            dispatch: {},
            transitionApplied: false,
        });
        await handler(
            new Request("http://test", {
                method: "POST",
                body: JSON.stringify({ requestKey: "r1" }),
            }),
            { params: Promise.resolve({ runId: "fwr_1" }) }
        );
        expect(incrementRetry).toHaveBeenCalledTimes(1);
    });
    it("retry rejects auth before mutation or notification", async () => {
        mockAuth.mockResolvedValue({ userId: null });
        const retryRunWithDispatch = jest.fn(),
            sendDispatchRequested = jest.fn(),
            incrementRetry = jest.fn();
        const handler = createFounderWeeklyReviewRetryPostHandler({
            actorResolver: { resolve: jest.fn() },
            retryRunWithDispatch,
            sendDispatchRequested,
            incrementRetry,
        });
        expect(
            (
                await handler(
                    new Request("http://test", {
                        method: "POST",
                        body: JSON.stringify({ requestKey: "r" }),
                    }),
                    { params: Promise.resolve({ runId: "x" }) }
                )
            ).status
        ).toBe(401);
        expect(retryRunWithDispatch).not.toHaveBeenCalled();
        expect(sendDispatchRequested).not.toHaveBeenCalled();
        expect(incrementRetry).not.toHaveBeenCalled();
    });
    it.each(["queued", "generating", "draft", "published"] as const)(
        "maps %s retry conflict safely",
        async status => {
            const retryRunWithDispatch = jest
                .fn()
                .mockRejectedValue(new FounderWeeklyReviewInvalidTransitionError(status, "retry"));
            const sendDispatchRequested = jest.fn(),
                incrementRetry = jest.fn();
            const handler = createFounderWeeklyReviewRetryPostHandler({
                actorResolver: { resolve: jest.fn().mockResolvedValue(actor) },
                retryRunWithDispatch,
                sendDispatchRequested,
                incrementRetry,
            });
            const response = await handler(
                new Request("http://test", {
                    method: "POST",
                    body: JSON.stringify({ requestKey: "r" }),
                }),
                { params: Promise.resolve({ runId: "fwr_1" }) }
            );
            expect(response.status).toBe(409);
            expect(incrementRetry).not.toHaveBeenCalled();
            expect(sendDispatchRequested).not.toHaveBeenCalled();
        }
    );
});
