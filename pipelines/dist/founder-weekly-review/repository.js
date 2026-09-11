import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { founderWeeklyReviewOperations, founderWeeklyReviewRuns, } from "./schema.js";
import { FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION, FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION, parseFounderWeeklyReviewEvidenceSnapshot, parseFounderWeeklyReviewCollectionInput, parseFounderWeeklyReviewModelMetadata, parseFounderWeeklyReviewPayload, } from "./contracts.js";
import { FounderWeeklyReviewInvalidPayloadError } from "./errors.js";
function mapRunRow(row) {
    const reviewPayload = row.reviewPayload
        ? parseFounderWeeklyReviewPayload(row.reviewPayload)
        : null;
    if (reviewPayload && reviewPayload.schemaVersion !== row.reviewSchemaVersion) {
        throw new FounderWeeklyReviewInvalidPayloadError(`Founder weekly review run "${row.id}" has mismatched review payload and review schema versions.`);
    }
    return {
        id: row.id,
        companyId: row.companyId,
        requestKey: row.requestKey,
        reportingPeriod: {
            start: row.reportingPeriodStart,
            end: row.reportingPeriodEnd,
        },
        status: row.status,
        reviewPayload,
        reviewSchemaVersion: row.reviewSchemaVersion,
        evidenceSnapshot: row.evidenceSnapshot
            ? parseFounderWeeklyReviewEvidenceSnapshot(row.evidenceSnapshot)
            : null,
        evidenceSchemaVersion: row.evidenceSchemaVersion,
        collectionInput: parseFounderWeeklyReviewCollectionInput(row.collectionInput),
        collectionClaimId: row.collectionClaimId ?? null,
        collectionStartedAt: row.collectionStartedAt ?? null,
        evidenceCollectedAt: row.evidenceCollectedAt ?? null,
        modelMetadata: row.modelMetadata
            ? parseFounderWeeklyReviewModelMetadata(row.modelMetadata)
            : null,
        createdByActorId: row.createdByActorId,
        retryCount: row.retryCount,
        failureSequence: row.failureSequence,
        generationAttempt: row.generationAttempt,
        generationClaimId: row.generationClaimId ?? null,
        generationJobId: row.generationJobId ?? null,
        queuedAt: row.queuedAt,
        claimedAt: row.claimedAt ?? null,
        generationStartedAt: row.generationStartedAt ?? null,
        generatedAt: row.generatedAt ?? null,
        publishedAt: row.publishedAt ?? null,
        errorCode: row.errorCode ?? null,
        errorMessage: row.errorMessage ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}
function mapOperationRow(row) {
    return {
        id: row.id,
        runId: row.runId,
        companyId: row.companyId,
        operationType: row.operationType,
        requestKey: row.requestKey,
        sourceFailureSequence: row.sourceFailureSequence,
        actorId: row.actorId,
        createdAt: row.createdAt,
    };
}
function truncateErrorMessage(value) {
    if (!value) {
        return null;
    }
    return value.length <= 1024 ? value : value.slice(0, 1024);
}
export class FounderWeeklyReviewRepository {
    db;
    constructor(db = getDb()) {
        this.db = db;
    }
    async createOrGetByRequestKey(input) {
        return (await this.createOrGetByRequestKeyWithResult(input)).run;
    }
    async createOrGetByRequestKeyWithResult(input) {
        const [inserted] = await this.db
            .insert(founderWeeklyReviewRuns)
            .values({
            id: input.id,
            companyId: input.companyId,
            requestKey: input.requestKey,
            reportingPeriodStart: input.reportingPeriod.start,
            reportingPeriodEnd: input.reportingPeriod.end,
            status: "queued",
            reviewPayload: null,
            reviewSchemaVersion: FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION,
            evidenceSnapshot: input.evidenceSnapshot ?? null,
            evidenceSchemaVersion: FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION,
            collectionInput: input.collectionInput ?? {
                workspaceTimezone: input.evidenceSnapshot?.workspaceTimezone ?? "UTC",
                actorExternalUserId: input.createdByActorId.replace(/^user:/, ""),
            },
            modelMetadata: null,
            createdByActorId: input.createdByActorId,
            queuedAt: new Date(),
            updatedAt: new Date(),
        })
            .onConflictDoNothing({
            target: [founderWeeklyReviewRuns.companyId, founderWeeklyReviewRuns.requestKey],
        })
            .returning();
        if (inserted) {
            return { run: mapRunRow(inserted), created: true };
        }
        const existing = await this.getByCompanyAndRequestKey(input.companyId, input.requestKey);
        if (!existing) {
            throw new Error("Failed to create or retrieve founder weekly review run");
        }
        return { run: existing, created: false };
    }
    async getByCompanyAndRunId(companyId, runId) {
        const [row] = await this.db
            .select()
            .from(founderWeeklyReviewRuns)
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.id, runId)))
            .limit(1);
        return row ? mapRunRow(row) : null;
    }
    async getByCompanyAndRequestKey(companyId, requestKey) {
        const [row] = await this.db
            .select()
            .from(founderWeeklyReviewRuns)
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.requestKey, requestKey)))
            .limit(1);
        return row ? mapRunRow(row) : null;
    }
    async listByCompany(companyId) {
        const rows = await this.db
            .select()
            .from(founderWeeklyReviewRuns)
            .where(eq(founderWeeklyReviewRuns.companyId, companyId))
            .orderBy(desc(founderWeeklyReviewRuns.createdAt), desc(founderWeeklyReviewRuns.id));
        return rows.map(mapRunRow);
    }
    async updateDraftConditionally(companyId, runId, reviewPayload) {
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            reviewPayload,
            reviewSchemaVersion: reviewPayload.schemaVersion,
            updatedAt: new Date(),
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.id, runId), eq(founderWeeklyReviewRuns.status, "draft")))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(companyId, runId),
        };
    }
    async publishConditionally(companyId, runId) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "published",
            publishedAt: now,
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.id, runId), eq(founderWeeklyReviewRuns.status, "draft")))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(companyId, runId),
        };
    }
    async claimQueuedRun(input) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "generating",
            generationAttempt: sql `${founderWeeklyReviewRuns.generationAttempt} + 1`,
            generationClaimId: input.generationClaimId,
            generationJobId: input.generationJobId ?? null,
            claimedAt: now,
            generationStartedAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "queued"), sql `${founderWeeklyReviewRuns.evidenceSnapshot} IS NOT NULL`))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(input.companyId, input.runId),
        };
    }
    async claimEvidenceCollection(input) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "collecting",
            collectionClaimId: input.collectionClaimId,
            collectionStartedAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "queued"), sql `${founderWeeklyReviewRuns.evidenceSnapshot} IS NULL`))
            .returning();
        return row
            ? { updated: true, run: mapRunRow(row) }
            : {
                updated: false,
                run: await this.getByCompanyAndRunId(input.companyId, input.runId),
            };
    }
    async attachEvidenceSnapshotIfAbsent(input, evidenceSnapshot) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "queued",
            evidenceSnapshot,
            evidenceSchemaVersion: evidenceSnapshot.schemaVersion,
            evidenceCollectedAt: now,
            collectionClaimId: null,
            queuedAt: now,
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "collecting"), eq(founderWeeklyReviewRuns.collectionClaimId, input.collectionClaimId), sql `${founderWeeklyReviewRuns.evidenceSnapshot} IS NULL`))
            .returning();
        return row
            ? { updated: true, run: mapRunRow(row) }
            : {
                updated: false,
                run: await this.getByCompanyAndRunId(input.companyId, input.runId),
            };
    }
    async markCollectionFailed(input, failure) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "failed",
            failureSequence: sql `${founderWeeklyReviewRuns.failureSequence} + 1`,
            errorCode: failure.errorCode,
            errorMessage: truncateErrorMessage(failure.errorMessage),
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "collecting"), eq(founderWeeklyReviewRuns.collectionClaimId, input.collectionClaimId)))
            .returning();
        return row
            ? { updated: true, run: mapRunRow(row) }
            : {
                updated: false,
                run: await this.getByCompanyAndRunId(input.companyId, input.runId),
            };
    }
    async saveGeneratedDraftWithClaim(input, reviewPayload, modelMetadata) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "draft",
            reviewPayload,
            reviewSchemaVersion: reviewPayload.schemaVersion,
            modelMetadata,
            generatedAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "generating"), eq(founderWeeklyReviewRuns.generationClaimId, input.generationClaimId)))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(input.companyId, input.runId),
        };
    }
    async markGenerationFailedWithClaim(input, failure) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "failed",
            failureSequence: sql `${founderWeeklyReviewRuns.failureSequence} + 1`,
            errorCode: failure.errorCode,
            errorMessage: truncateErrorMessage(failure.errorMessage),
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "generating"), eq(founderWeeklyReviewRuns.generationClaimId, input.generationClaimId)))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(input.companyId, input.runId),
        };
    }
    async markQueuedRunFailed(companyId, runId, failure) {
        const now = new Date();
        const [row] = await this.db
            .update(founderWeeklyReviewRuns)
            .set({
            status: "failed",
            failureSequence: sql `${founderWeeklyReviewRuns.failureSequence} + 1`,
            errorCode: failure.errorCode,
            errorMessage: truncateErrorMessage(failure.errorMessage),
            updatedAt: now,
        })
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.id, runId), eq(founderWeeklyReviewRuns.status, "queued")))
            .returning();
        if (row) {
            return { updated: true, run: mapRunRow(row) };
        }
        return {
            updated: false,
            run: await this.getByCompanyAndRunId(companyId, runId),
        };
    }
    async retryFailedRun(input) {
        return this.db.transaction(async (tx) => {
            const [currentRow] = await tx
                .select()
                .from(founderWeeklyReviewRuns)
                .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId)))
                .limit(1);
            if (!currentRow) {
                return {
                    outcome: "not_found",
                    run: null,
                    operation: null,
                };
            }
            const [existingOperationRow] = await tx
                .select()
                .from(founderWeeklyReviewOperations)
                .where(and(eq(founderWeeklyReviewOperations.companyId, input.companyId), eq(founderWeeklyReviewOperations.runId, input.runId), eq(founderWeeklyReviewOperations.operationType, "retry"), eq(founderWeeklyReviewOperations.requestKey, input.requestKey)))
                .limit(1);
            const currentRun = mapRunRow(currentRow);
            if (existingOperationRow) {
                const operation = mapOperationRow(existingOperationRow);
                if (operation.sourceFailureSequence !== currentRun.failureSequence) {
                    return {
                        outcome: "conflict",
                        run: currentRun,
                        operation,
                    };
                }
                return {
                    outcome: "idempotent",
                    run: currentRun,
                    operation,
                };
            }
            if (currentRun.status !== "failed") {
                return {
                    outcome: "conflict",
                    run: currentRun,
                    operation: null,
                };
            }
            const [insertedOperationRow] = await tx
                .insert(founderWeeklyReviewOperations)
                .values({
                id: input.operationId,
                runId: input.runId,
                companyId: input.companyId,
                operationType: "retry",
                requestKey: input.requestKey,
                sourceFailureSequence: currentRun.failureSequence,
                actorId: input.actorId,
            })
                .onConflictDoNothing({
                target: [
                    founderWeeklyReviewOperations.runId,
                    founderWeeklyReviewOperations.operationType,
                    founderWeeklyReviewOperations.requestKey,
                ],
            })
                .returning();
            if (!insertedOperationRow) {
                const [conflictingOperationRow] = await tx
                    .select()
                    .from(founderWeeklyReviewOperations)
                    .where(and(eq(founderWeeklyReviewOperations.companyId, input.companyId), eq(founderWeeklyReviewOperations.runId, input.runId), eq(founderWeeklyReviewOperations.operationType, "retry"), eq(founderWeeklyReviewOperations.requestKey, input.requestKey)))
                    .limit(1);
                return {
                    outcome: conflictingOperationRow &&
                        conflictingOperationRow.sourceFailureSequence === currentRun.failureSequence
                        ? "idempotent"
                        : "conflict",
                    run: await this.getRunInsideTransaction(tx, input.companyId, input.runId),
                    operation: conflictingOperationRow
                        ? mapOperationRow(conflictingOperationRow)
                        : null,
                };
            }
            const now = new Date();
            const [updatedRow] = await tx
                .update(founderWeeklyReviewRuns)
                .set({
                status: "queued",
                retryCount: sql `${founderWeeklyReviewRuns.retryCount} + 1`,
                generationClaimId: null,
                generationJobId: null,
                claimedAt: null,
                generationStartedAt: null,
                generatedAt: null,
                queuedAt: now,
                errorCode: null,
                errorMessage: null,
                updatedAt: now,
            })
                .where(and(eq(founderWeeklyReviewRuns.companyId, input.companyId), eq(founderWeeklyReviewRuns.id, input.runId), eq(founderWeeklyReviewRuns.status, "failed"), eq(founderWeeklyReviewRuns.failureSequence, currentRun.failureSequence)))
                .returning();
            if (!updatedRow) {
                return {
                    outcome: "conflict",
                    run: await this.getRunInsideTransaction(tx, input.companyId, input.runId),
                    operation: mapOperationRow(insertedOperationRow),
                };
            }
            return {
                outcome: "updated",
                run: mapRunRow(updatedRow),
                operation: mapOperationRow(insertedOperationRow),
            };
        });
    }
    async getRunInsideTransaction(tx, companyId, runId) {
        const [row] = await tx
            .select()
            .from(founderWeeklyReviewRuns)
            .where(and(eq(founderWeeklyReviewRuns.companyId, companyId), eq(founderWeeklyReviewRuns.id, runId)))
            .limit(1);
        return row ? mapRunRow(row) : null;
    }
}
//# sourceMappingURL=repository.js.map