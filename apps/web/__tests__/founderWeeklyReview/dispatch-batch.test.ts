/**
 * Batch accounting and the decision to chain another drain.
 *
 * This is the half of the retry-storm fix that is not in the database: even
 * with per-row backoff, re-enqueuing a drain after a batch that wholly failed
 * would keep the dispatcher spinning through an outage.
 */

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));

import {
    runFounderWeeklyReviewDispatchBatch,
    shouldChainAnotherDrain,
} from "~/server/inngest/functions/founderWeeklyReview";
import { DISPATCH_CLAIM_BATCH_SIZE } from "~/server/founder-weekly-review/dispatch-service";

function dispatch(index: number) {
    return {
        id: `d${index}`,
        companyId: 1n,
        runId: `fwr_${index}`,
        operationType: "create" as const,
        operationKey: `k${index}`,
        eventId: `event-${index}`,
        generationJobId: `job-${index}`,
        generationClaimId: `claim-${index}`,
        status: "dispatching" as const,
        attemptCount: 1,
        availableAt: new Date(),
    };
}

function deps(overrides: { count?: number; send?: jest.Mock; recordFailure?: jest.Mock }) {
    const batch = Array.from({ length: overrides.count ?? 0 }, (_, i) => dispatch(i));
    return {
        claim: jest.fn().mockResolvedValue(batch),
        send: overrides.send ?? jest.fn().mockResolvedValue(undefined),
        markDispatched: jest.fn().mockResolvedValue(undefined),
        recordFailure:
            overrides.recordFailure ??
            jest
                .fn()
                .mockResolvedValue({ status: "pending", attemptCount: 1, availableAt: new Date() }),
    } as unknown as Parameters<typeof runFounderWeeklyReviewDispatchBatch>[0];
}

describe("founder weekly review dispatch batch", () => {
    it("counts a fully successful batch and chains another drain", async () => {
        const result = await runFounderWeeklyReviewDispatchBatch(
            deps({ count: DISPATCH_CLAIM_BATCH_SIZE })
        );
        expect(result).toEqual({
            claimed: DISPATCH_CLAIM_BATCH_SIZE,
            succeeded: DISPATCH_CLAIM_BATCH_SIZE,
            retired: 0,
        });
        expect(shouldChainAnotherDrain(result)).toBe(true);
    });

    it("does not chain when a full batch fails entirely", async () => {
        const recordFailure = jest
            .fn()
            .mockResolvedValue({ status: "pending", attemptCount: 1, availableAt: new Date() });
        const result = await runFounderWeeklyReviewDispatchBatch(
            deps({
                count: DISPATCH_CLAIM_BATCH_SIZE,
                send: jest.fn().mockRejectedValue(new Error("inngest is down")),
                recordFailure,
            })
        );

        expect(result.succeeded).toBe(0);
        expect(recordFailure).toHaveBeenCalledTimes(DISPATCH_CLAIM_BATCH_SIZE);
        // The storm: claim 20 → all fail → chain → claim the same 20 → repeat.
        expect(shouldChainAnotherDrain(result)).toBe(false);
    });

    it("does not chain when a full batch only partly succeeds", async () => {
        let call = 0;
        const send = jest.fn().mockImplementation(() => {
            call += 1;
            return call === 1 ? Promise.reject(new Error("flaky")) : Promise.resolve(undefined);
        });
        const result = await runFounderWeeklyReviewDispatchBatch(
            deps({ count: DISPATCH_CLAIM_BATCH_SIZE, send })
        );

        expect(result.succeeded).toBe(DISPATCH_CLAIM_BATCH_SIZE - 1);
        expect(shouldChainAnotherDrain(result)).toBe(false);
    });

    it("does not chain on a partial batch, because there is nothing left to drain", async () => {
        const result = await runFounderWeeklyReviewDispatchBatch(deps({ count: 3 }));
        expect(result.succeeded).toBe(3);
        expect(shouldChainAnotherDrain(result)).toBe(false);
    });

    it("reports rows retired after exhausting their attempts", async () => {
        const result = await runFounderWeeklyReviewDispatchBatch(
            deps({
                count: 2,
                send: jest.fn().mockRejectedValue(new Error("inngest is down")),
                recordFailure: jest.fn().mockResolvedValue({
                    status: "failed",
                    attemptCount: 8,
                    availableAt: new Date(),
                }),
            })
        );
        expect(result).toMatchObject({ claimed: 2, succeeded: 0, retired: 2 });
    });
});
