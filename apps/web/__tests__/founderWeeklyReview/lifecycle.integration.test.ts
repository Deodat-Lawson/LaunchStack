import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { company } from "@launchstack/core/db/schema";
import {
    FounderWeeklyReviewConflictError,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    FounderWeeklyReviewInvalidPayloadError,
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
    FounderWeeklyReviewRepository,
    FounderWeeklyReviewUserService,
    FounderWeeklyReviewWorkerService,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewPayload,
    type FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

function createEvidenceSnapshot(): FounderWeeklyReviewEvidenceSnapshot {
    return FounderWeeklyReviewEvidenceSnapshotSchema.parse({
        schemaVersion: "founder-weekly-review-evidence/v1",
        capturedAt: "2026-07-18T10:00:00.000Z",
        reportingPeriod: {
            start: "2026-07-07",
            end: "2026-07-13",
        },
        workspaceTimezone: "America/Los_Angeles",
        items: [
            {
                sourceType: "document_change",
                sourceId: "doc-1",
                title: "Weekly Product Notes",
                sourceTimestamp: "2026-07-10T18:15:00.000Z",
                excerpt: "Shipped billing exports and fixed onboarding activation delay.",
                workspaceDeepLink: "launchstack://workspace/documents/doc-1",
                metadata: {
                    documentType: "note",
                    tags: ["product", "ops"],
                },
            },
            {
                sourceType: "customer_feedback",
                sourceId: "feedback-1",
                title: "Customer call summary",
                excerpt: "Two enterprise prospects asked for stronger audit logging.",
                canonicalUrl: "https://example.com/customer-feedback/1",
                metadata: {
                    sentiment: "mixed",
                },
            },
            {
                sourceType: "founder_context",
                sourceId: "founder-context-1",
                title: "Founder weekly context",
                excerpt: "Manual founder input: enterprise onboarding remains blocked on SSO setup.",
            },
        ],
        sourceWarnings: [
            {
                code: "missing_github_activity",
                message: "GitHub activity collection is not part of LAU-5.",
                sourceType: "github_activity",
            },
        ],
    });
}

function createPayload(seed: string): FounderWeeklyReviewPayload {
    const observed = {
        kind: "observed_fact" as const,
        text: `Observed fact ${seed}`,
        sourceIds: ["doc-1"],
        confidence: "high" as const,
    };
    const recommended = {
        kind: "recommended_item" as const,
        text: `Recommended item ${seed}`,
        sourceIds: ["feedback-1"],
        confidence: "medium" as const,
    };

    return {
        schemaVersion: "founder-weekly-review/v1",
        sections: {
            whatChanged: { heading: "What changed", items: [observed] },
            whatShipped: { heading: "What shipped", items: [observed] },
            whatCustomersSaid: { heading: "What customers said", items: [observed] },
            currentBlockers: { heading: "Current blockers", items: [recommended] },
            nextPriorities: { heading: "Next priorities", items: [recommended] },
        },
    };
}

function createV2Payload(): FounderWeeklyReviewV2Payload {
    return {
        schemaVersion: "founder-weekly-review/v2",
        sections: {
            whatChanged: {
                state: "evidence",
                items: [{
                    kind: "observed_fact",
                    text: "Billing exports changed.",
                    sourceIds: ["doc-1"],
                    confidence: 0.9,
                }],
            },
            whatShipped: {
                state: "evidence",
                items: [{
                    kind: "observed_fact",
                    text: "Billing exports shipped.",
                    sourceIds: ["doc-1"],
                    confidence: 0.9,
                }],
            },
            whatCustomersSaid: {
                state: "evidence",
                items: [{
                    kind: "observed_fact",
                    text: "Prospects requested audit logging.",
                    sourceIds: ["feedback-1"],
                    confidence: 0.8,
                }],
            },
            currentBlockers: {
                state: "evidence",
                items: [{
                    kind: "observed_fact",
                    text: "SSO setup remains blocked.",
                    sourceIds: ["founder-context-1"],
                    confidence: 0.8,
                }],
            },
            nextPriorities: {
                state: "evidence",
                items: [{
                    kind: "recommendation",
                    label: "Recommendation",
                    text: "Prioritize SSO setup.",
                    sourceIds: ["founder-context-1"],
                    confidence: 0.8,
                    rationale: null,
                }],
            },
        },
    };
}

async function insertCompany(
    db: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>["db"],
    name: string
): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
        VALUES (${name}, '5')
        RETURNING "id"
    `);

    const [result] = rows;

    if (!result || typeof result !== "object" || !("id" in result)) {
        throw new Error(`Failed to insert company fixture for ${name}`);
    }

    const id = result.id;

    if (
        typeof id !== "number" &&
        typeof id !== "string" &&
        typeof id !== "bigint"
    ) {
        throw new Error(`Invalid company ID returned for ${name}`);
    }

    return BigInt(id);
}

describeIfDatabase("Founder Weekly Review lifecycle integration", () => {
    it("covers create idempotency, isolation, lifecycle transitions, claims, retries, and immutability", async () => {
        const testDb = await createFounderWeeklyReviewTestDatabase();
        const extraSession = await testDb.createSession();
        const thirdSession = await testDb.createSession();

        try {
            const companyAId = await insertCompany(testDb.db, "Alpha");
            const companyBId = await insertCompany(testDb.db, "Beta");
            const repositoryA = new FounderWeeklyReviewRepository(testDb.db);
            const repositoryB = new FounderWeeklyReviewRepository(extraSession.db);
            const userServiceA = new FounderWeeklyReviewUserService(repositoryA);
            const userServiceB = new FounderWeeklyReviewUserService(repositoryB);
            const workerA = new FounderWeeklyReviewWorkerService(repositoryA);
            const workerB = new FounderWeeklyReviewWorkerService(
                new FounderWeeklyReviewRepository(thirdSession.db)
            );

            const actorA = {
                externalUserId: "clerk_alpha",
                internalUserId: 101n,
                companyId: companyAId,
                role: "owner",
            };
            const actorB = {
                externalUserId: "clerk_beta",
                internalUserId: 202n,
                companyId: companyBId,
                role: "owner",
            };

            const snapshot = createEvidenceSnapshot();
            expect(JSON.stringify(snapshot)).not.toMatch(
                /token|api[_-]?key|authorization|signedUrl|presigned/i
            );

            const created = await userServiceA.createOrGetRun(actorA, {
                requestKey: "create-1",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            expect(created.status).toBe("queued");
            expect(created.evidenceSnapshot).toEqual(snapshot);

            const createdAgain = await userServiceA.createOrGetRun(actorA, {
                requestKey: "create-1",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: {
                    ...snapshot,
                    items: [],
                },
            });
            expect(createdAgain.id).toBe(created.id);
            expect(createdAgain.evidenceSnapshot).toEqual(snapshot);

            const companyBRun = await userServiceB.createOrGetRun(actorB, {
                requestKey: "create-1",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            expect(companyBRun.id).not.toBe(created.id);

            await expect(userServiceB.getRun(actorB, created.id)).rejects.toBeInstanceOf(
                FounderWeeklyReviewNotFoundError
            );
            await expect(
                userServiceB.updateDraft(actorB, created.id, createPayload("wrong-company"))
            ).rejects.toBeInstanceOf(FounderWeeklyReviewNotFoundError);
            await expect(userServiceB.publishDraft(actorB, created.id)).rejects.toBeInstanceOf(
                FounderWeeklyReviewNotFoundError
            );
            await expect(
                userServiceB.retryFailedRun(actorB, created.id, "retry-wrong-company")
            ).rejects.toBeInstanceOf(FounderWeeklyReviewNotFoundError);
            await expect(
                workerB.claimQueuedRun({
                    companyId: companyBId,
                    runId: created.id,
                    generationClaimId: "claim-wrong-company",
                })
            ).rejects.toBeInstanceOf(FounderWeeklyReviewNotFoundError);

            const claimOne = await workerA.claimQueuedRun({
                companyId: companyAId,
                runId: created.id,
                generationClaimId: "claim-1",
                generationJobId: "job-1",
            });
            expect(claimOne.status).toBe("generating");
            expect(claimOne.generationAttempt).toBe(1);

            const claimOneAgain = await workerA.claimQueuedRun({
                companyId: companyAId,
                runId: created.id,
                generationClaimId: "claim-1",
                generationJobId: "job-1",
            });
            expect(claimOneAgain.generationAttempt).toBe(1);

            await expect(
                workerB.saveGeneratedDraft(
                    {
                        companyId: companyAId,
                        runId: created.id,
                        generationClaimId: "claim-2",
                    },
                    createPayload("claim-mismatch"),
                    null
                )
            ).rejects.toMatchObject({ code: "claim_ownership_mismatch" });

            const generatedDraft = await workerA.saveGeneratedDraft(
                {
                    companyId: companyAId,
                    runId: created.id,
                    generationClaimId: "claim-1",
                    generationJobId: "job-1",
                },
                createPayload("draft-1"),
                {
                    provider: "openai",
                    model: "gpt-5-mini",
                    attributes: { latencyMs: 1300 },
                }
            );
            expect(generatedDraft.status).toBe("draft");
            expect(generatedDraft.generatedAt).not.toBeNull();

            const editedDraft = await userServiceA.updateDraft(
                actorA,
                created.id,
                createPayload("draft-2")
            );
            expect(editedDraft.status).toBe("draft");
            expect(editedDraft.reviewPayload?.schemaVersion).toBe(
                "founder-weekly-review/v1"
            );
            if (
                !editedDraft.reviewPayload ||
                editedDraft.reviewPayload.schemaVersion !== "founder-weekly-review/v1"
            ) {
                throw new Error("Expected v1 draft payload");
            }
            expect(editedDraft.reviewPayload.sections.whatChanged.items[0]).toMatchObject({
                text: "Observed fact draft-2",
            });

            const published = await userServiceA.publishDraft(actorA, created.id);
            expect(published.status).toBe("published");
            expect(published.publishedAt).not.toBeNull();
            expect(published.evidenceSnapshot).toEqual(snapshot);

            const republished = await userServiceA.publishDraft(actorA, created.id);
            expect(republished.status).toBe("published");
            expect(republished.publishedAt?.toISOString()).toBe(
                published.publishedAt?.toISOString()
            );

            await expect(
                userServiceA.updateDraft(actorA, created.id, createPayload("after-publish"))
            ).rejects.toBeInstanceOf(FounderWeeklyReviewInvalidTransitionError);
            await expect(
                userServiceA.retryFailedRun(actorA, created.id, "retry-published")
            ).rejects.toBeInstanceOf(FounderWeeklyReviewInvalidTransitionError);

            const failedBeforeClaim = await userServiceA.createOrGetRun(actorA, {
                requestKey: "queued-fail",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            const queuedFailure = await workerA.markQueuedRunFailed(
                companyAId,
                failedBeforeClaim.id,
                {
                    errorCode: "EVIDENCE_INVALID",
                    errorMessage: "e".repeat(2000),
                }
            );
            expect(queuedFailure.status).toBe("failed");
            expect(queuedFailure.failureSequence).toBe(1);
            expect(queuedFailure.errorMessage?.length).toBeLessThanOrEqual(1024);

            const retried = await userServiceA.retryFailedRun(
                actorA,
                failedBeforeClaim.id,
                "retry-1"
            );
            expect(retried.status).toBe("queued");
            expect(retried.retryCount).toBe(1);
            expect(retried.errorCode).toBeNull();
            expect(retried.generationClaimId).toBeNull();
            expect(retried.evidenceSnapshot).toEqual(snapshot);

            const retriedAgain = await userServiceA.retryFailedRun(
                actorA,
                failedBeforeClaim.id,
                "retry-1"
            );
            expect(retriedAgain.retryCount).toBe(1);

            const claimRaceRun = await userServiceA.createOrGetRun(actorA, {
                requestKey: "claim-race",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            const raceResults = await Promise.allSettled([
                workerA.claimQueuedRun({
                    companyId: companyAId,
                    runId: claimRaceRun.id,
                    generationClaimId: "race-1",
                }),
                workerB.claimQueuedRun({
                    companyId: companyAId,
                    runId: claimRaceRun.id,
                    generationClaimId: "race-2",
                }),
            ]);
            const fulfilledClaims = raceResults.filter(
                (result): result is PromiseFulfilledResult<Awaited<typeof claimOne>> =>
                    result.status === "fulfilled"
            );
            const rejectedClaims = raceResults.filter(
                (result): result is PromiseRejectedResult => result.status === "rejected"
            );
            expect(fulfilledClaims).toHaveLength(1);
            expect(rejectedClaims).toHaveLength(1);
            expect(rejectedClaims[0]?.reason).toBeInstanceOf(FounderWeeklyReviewConflictError);

            const generatingFailureRun = await userServiceA.createOrGetRun(actorA, {
                requestKey: "generation-fail",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            const generatingFailureClaim = await workerA.claimQueuedRun({
                companyId: companyAId,
                runId: generatingFailureRun.id,
                generationClaimId: "gf-1",
            });
            expect(generatingFailureClaim.status).toBe("generating");

            const failed = await workerA.markGenerationFailed(
                {
                    companyId: companyAId,
                    runId: generatingFailureRun.id,
                    generationClaimId: "gf-1",
                },
                {
                    errorCode: "MODEL_TIMEOUT",
                    errorMessage: "provider timed out",
                }
            );
            expect(failed.status).toBe("failed");
            expect(failed.failureSequence).toBe(1);

            const failedAgain = await workerA.markGenerationFailed(
                {
                    companyId: companyAId,
                    runId: generatingFailureRun.id,
                    generationClaimId: "gf-1",
                },
                {
                    errorCode: "MODEL_TIMEOUT",
                    errorMessage: "provider timed out",
                }
            );
            expect(failedAgain.failureSequence).toBe(1);

            const retryRaceRun = await userServiceA.retryFailedRun(
                actorA,
                generatingFailureRun.id,
                "retry-generation-1"
            );
            expect(retryRaceRun.retryCount).toBe(1);

            const secondClaim = await workerA.claimQueuedRun({
                companyId: companyAId,
                runId: generatingFailureRun.id,
                generationClaimId: "gf-2",
            });
            expect(secondClaim.generationAttempt).toBe(2);

            const secondFailure = await workerA.markGenerationFailed(
                {
                    companyId: companyAId,
                    runId: generatingFailureRun.id,
                    generationClaimId: "gf-2",
                },
                {
                    errorCode: "MODEL_TIMEOUT",
                    errorMessage: "provider timed out again",
                }
            );
            expect(secondFailure.failureSequence).toBe(2);

            await expect(
                userServiceA.retryFailedRun(actorA, generatingFailureRun.id, "retry-generation-1")
            ).rejects.toBeInstanceOf(FounderWeeklyReviewConflictError);

            const concurrentRetryRun = await userServiceA.createOrGetRun(actorA, {
                requestKey: "retry-race",
                reportingPeriod: snapshot.reportingPeriod,
                evidenceSnapshot: snapshot,
            });
            await workerA.markQueuedRunFailed(companyAId, concurrentRetryRun.id, {
                errorCode: "DISPATCH_FAILED",
                errorMessage: "queue dispatch failed",
            });
            const concurrentRetryResults = await Promise.all([
                userServiceA.retryFailedRun(actorA, concurrentRetryRun.id, "same-retry-key"),
                userServiceA.retryFailedRun(actorA, concurrentRetryRun.id, "same-retry-key"),
            ]);
            expect(concurrentRetryResults[0].retryCount).toBe(1);
            expect(concurrentRetryResults[1].retryCount).toBe(1);

            const listed = await userServiceA.listRuns(actorA);
            expect(listed.length).toBeGreaterThanOrEqual(5);

            await expect(
                userServiceA.updateDraft(
                    actorA,
                    claimRaceRun.id,
                    {
                        schemaVersion: "founder-weekly-review/v1",
                    } as FounderWeeklyReviewPayload
                )
            ).rejects.toBeInstanceOf(FounderWeeklyReviewInvalidPayloadError);
        } finally {
            await thirdSession.close();
            await extraSession.close();
            await testDb.close();
        }
    });

    it("round-trips v2 drafts and rejects mismatched persisted schema versions", async () => {
        const testDb = await createFounderWeeklyReviewTestDatabase();
        try {
            const companyId = await insertCompany(testDb.db, "V2 Review Co");
            const repository = new FounderWeeklyReviewRepository(testDb.db);
            const userService = new FounderWeeklyReviewUserService(repository);
            const worker = new FounderWeeklyReviewWorkerService(repository);
            const actor = {
                externalUserId: "clerk_v2",
                companyId,
                role: "owner",
            };
            const evidenceSnapshot = createEvidenceSnapshot();
            const run = await userService.createOrGetRun(actor, {
                requestKey: "v2-round-trip",
                reportingPeriod: evidenceSnapshot.reportingPeriod,
                evidenceSnapshot,
            });
            const claim = { companyId, runId: run.id, generationClaimId: "v2-claim" };
            await worker.claimQueuedRun(claim);

            const payload = createV2Payload();
            const saved = await worker.saveGeneratedDraft(claim, payload, {
                provider: "openai",
                model: "gpt-4o-mini",
                capability: "founderWeeklyReview",
                temperature: 0,
                attributes: {},
            });
            expect(saved.reviewPayload).toEqual(payload);
            expect(saved.reviewPayload?.schemaVersion).toBe("founder-weekly-review/v2");
            expect(saved.reviewSchemaVersion).toBe("founder-weekly-review/v2");

            const reread = await repository.getByCompanyAndRunId(companyId, run.id);
            expect(reread?.reviewPayload).toEqual(payload);
            expect(reread?.reviewPayload?.schemaVersion).toBe("founder-weekly-review/v2");
            expect(reread?.reviewSchemaVersion).toBe("founder-weekly-review/v2");

            await testDb.db.execute(sql`
                UPDATE "pdr_ai_v2_founder_weekly_review_runs"
                SET "review_schema_version" = 'founder-weekly-review/v1'
                WHERE "id" = ${run.id}
            `);
            await expect(repository.getByCompanyAndRunId(companyId, run.id)).rejects.toBeInstanceOf(
                FounderWeeklyReviewInvalidPayloadError
            );
        } finally {
            await testDb.close();
        }
    });
});
