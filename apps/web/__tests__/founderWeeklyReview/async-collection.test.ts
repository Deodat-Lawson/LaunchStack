jest.mock("~/server/db", () => ({ db: { transaction: jest.fn() } }));
import { company } from "@launchstack/store/schema";
import {
    FounderWeeklyReviewEvidenceSnapshotSchema,
    FounderWeeklyReviewRepository,
    FounderWeeklyReviewWorkerService,
} from "@launchstack/pipelines/founder-weekly-review";
import { createFounderWeeklyReviewDispatchService } from "~/server/founder-weekly-review/dispatch-service";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;
const snapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
    schemaVersion: "founder-weekly-review-evidence/v1",
    capturedAt: "2026-07-13T00:00:00.000Z",
    reportingPeriod: { start: "2026-07-06", end: "2026-07-12" },
    workspaceTimezone: "UTC",
    items: [],
    sourceWarnings: [],
});

describeDb("Founder Weekly Review async evidence workflow", () => {
    jest.setTimeout(120_000);

    it("creates without a snapshot, attaches it once, and then permits generation claim", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [companyRow] = await test.db
                .insert(company)
                .values({ name: "Workflow", numberOfEmployees: "1" })
                .returning();
            const actor = {
                externalUserId: "u",
                internalUserId: 1n,
                companyId: BigInt(companyRow!.id),
                role: "owner",
            };
            const created = await createFounderWeeklyReviewDispatchService(
                test.db
            ).createRunWithDispatch({
                actor,
                requestKey: "workflow",
                reportingPeriod: snapshot.reportingPeriod,
                collectionInput: {
                    workspaceTimezone: "UTC",
                    founderContext: "bounded",
                    actorExternalUserId: "u",
                },
            });
            expect(created.run.status).toBe("queued");
            expect(created.run.evidenceSnapshot).toBeNull();
            const worker = new FounderWeeklyReviewWorkerService(
                new FounderWeeklyReviewRepository(test.db)
            );
            const context = {
                companyId: actor.companyId,
                runId: created.run.id,
                collectionClaimId: "collection-1",
            };
            const collecting = await worker.claimEvidenceCollection(context);
            expect(collecting.status).toBe("collecting");
            const attached = await worker.attachEvidenceSnapshotIfAbsent(context, snapshot);
            expect(attached.status).toBe("queued");
            expect(attached.evidenceSnapshot).toEqual(snapshot);
            await expect(
                worker.attachEvidenceSnapshotIfAbsent(context, snapshot)
            ).resolves.toMatchObject({ id: created.run.id });
            const generating = await worker.claimQueuedRun({
                companyId: actor.companyId,
                runId: created.run.id,
                generationClaimId: "generation-1",
                generationJobId: "job-1",
            });
            expect(generating.status).toBe("generating");
        } finally {
            await test.close();
        }
    });

    it("retries collection failures without creating a snapshot or another run", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [companyRow] = await test.db
                .insert(company)
                .values({ name: "Recovery", numberOfEmployees: "1" })
                .returning();
            const actor = {
                externalUserId: "u",
                internalUserId: 1n,
                companyId: BigInt(companyRow!.id),
                role: "owner",
            };
            const service = createFounderWeeklyReviewDispatchService(test.db);
            const created = await service.createRunWithDispatch({
                actor,
                requestKey: "collection-failure",
                reportingPeriod: snapshot.reportingPeriod,
                collectionInput: { workspaceTimezone: "UTC", actorExternalUserId: "u" },
            });
            const worker = new FounderWeeklyReviewWorkerService(
                new FounderWeeklyReviewRepository(test.db)
            );
            const collecting = await worker.claimEvidenceCollection({
                companyId: actor.companyId,
                runId: created.run.id,
                collectionClaimId: "collection-failure-claim",
            });
            expect(collecting.status).toBe("collecting");
            const failed = await worker.markCollectionFailed(
                {
                    companyId: actor.companyId,
                    runId: created.run.id,
                    collectionClaimId: "collection-failure-claim",
                },
                { errorCode: "evidence_collection_failed" }
            );
            expect(failed.status).toBe("failed");
            expect(failed.evidenceSnapshot).toBeNull();
            const retried = await service.retryRunWithDispatch({
                actor,
                runId: created.run.id,
                requestKey: "collection-retry",
            });
            expect(retried.run.id).toBe(created.run.id);
            expect(retried.run.retryCount).toBe(1);
            expect(retried.run.evidenceSnapshot).toBeNull();
            await expect(
                worker.claimEvidenceCollection({
                    companyId: actor.companyId,
                    runId: created.run.id,
                    collectionClaimId: retried.dispatch.generationClaimId,
                })
            ).resolves.toMatchObject({ status: "collecting" });
        } finally {
            await test.close();
        }
    });
});
