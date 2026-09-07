/**
 * Routing of the exhausted-retries callback.
 *
 * The repository mutations are covered elsewhere; what is covered here is the
 * part that had no test and was wrong twice: reading the run identifiers out of
 * Inngest's failure envelope, and picking the mutation that matches the status
 * the run is actually in.
 */

jest.mock("~/server/db", () => ({ db: {} }));
// Only the failure routing is under test; stub the model resolution so the
// import graph does not drag in the ESM-only env loader.
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));

import type { FounderWeeklyReviewWorkerService } from "@launchstack/pipelines/founder-weekly-review";
import { handleFounderWeeklyReviewGenerationFailure } from "~/server/inngest/functions/founderWeeklyReview";

type Status = "queued" | "collecting" | "generating" | "draft" | "published" | "failed";

function workerStub(status: Status | null) {
    return {
        getRun: jest
            .fn()
            .mockResolvedValue(status === null ? null : { status, evidenceSnapshot: null }),
        markCollectionFailed: jest.fn().mockResolvedValue(undefined),
        markGenerationFailed: jest.fn().mockResolvedValue(undefined),
        markQueuedRunFailed: jest.fn().mockResolvedValue(undefined),
    };
}

/** The shape Inngest delivers to onFailure: the trigger nested under data.event. */
function failureEnvelope(data: Record<string, unknown>) {
    return { name: "inngest/function.failed", data: { error: {}, event: { data } } };
}

const TRIGGER = {
    runId: "fwr_1",
    companyId: "7",
    generationJobId: "job-1",
    generationClaimId: "claim-1",
};

function run(status: Status | null, envelope: unknown = failureEnvelope(TRIGGER)) {
    const worker = workerStub(status);
    return handleFounderWeeklyReviewGenerationFailure(
        envelope,
        worker as unknown as FounderWeeklyReviewWorkerService
    ).then(() => worker);
}

describe("founder weekly review generation failure routing", () => {
    it("marks a collecting run as a collection failure", async () => {
        const worker = await run("collecting");
        expect(worker.markCollectionFailed).toHaveBeenCalledWith(
            { companyId: 7n, runId: "fwr_1", collectionClaimId: "claim-1" },
            expect.objectContaining({ errorCode: "evidence_collection_failed" })
        );
        expect(worker.markGenerationFailed).not.toHaveBeenCalled();
        expect(worker.markQueuedRunFailed).not.toHaveBeenCalled();
    });

    it("marks a generating run as a generation failure", async () => {
        const worker = await run("generating");
        expect(worker.markGenerationFailed).toHaveBeenCalledWith(
            {
                companyId: 7n,
                runId: "fwr_1",
                generationJobId: "job-1",
                generationClaimId: "claim-1",
            },
            expect.objectContaining({ errorCode: "generation_failed" })
        );
        expect(worker.markQueuedRunFailed).not.toHaveBeenCalled();
    });

    it("marks a still-queued run as failed rather than leaving it queued forever", async () => {
        // Retries can run out before either claim lands. The generating
        // mutation is guarded on status='generating', so routing this case
        // there silently did nothing and the run stayed queued.
        const worker = await run("queued");
        expect(worker.markQueuedRunFailed).toHaveBeenCalledWith(
            7n,
            "fwr_1",
            expect.objectContaining({ errorCode: "generation_failed" })
        );
        expect(worker.markGenerationFailed).not.toHaveBeenCalled();
        expect(worker.markCollectionFailed).not.toHaveBeenCalled();
    });

    it.each(["draft", "published", "failed"] as const)(
        "leaves a %s run untouched",
        async status => {
            const worker = await run(status);
            expect(worker.markCollectionFailed).not.toHaveBeenCalled();
            expect(worker.markGenerationFailed).not.toHaveBeenCalled();
            expect(worker.markQueuedRunFailed).not.toHaveBeenCalled();
        }
    );

    it("does nothing when the run no longer exists", async () => {
        const worker = await run(null);
        expect(worker.markGenerationFailed).not.toHaveBeenCalled();
    });

    it("ignores an envelope whose nested trigger is missing", async () => {
        const worker = await run("generating", { data: { error: {} } });
        expect(worker.getRun).not.toHaveBeenCalled();
    });

    it("does not read identifiers from the top-level envelope data", async () => {
        // Guards the original defect: the trigger fields sit at data.event.data,
        // never at data. Accepting them at the top level would let this pass
        // while production silently no-ops.
        const worker = await run("generating", { data: TRIGGER });
        expect(worker.getRun).not.toHaveBeenCalled();
    });
});
