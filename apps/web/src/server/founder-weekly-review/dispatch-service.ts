import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "~/server/db";
import type { DbClient } from "@launchstack/core/db";
import {
    founderWeeklyReviewDispatches,
    type FounderWeeklyReviewDispatchRow,
} from "@launchstack/core/db/schema";
import {
    FounderWeeklyReviewRepository,
    FounderWeeklyReviewUserService,
    type FounderWeeklyReviewRunRecord,
    type FounderWeeklyReviewUserActor,
    type ReportingPeriod,
    type FounderWeeklyReviewEvidenceSnapshot,
} from "@launchstack/features/founder-weekly-review";

export type FounderWeeklyReviewDispatch = Pick<FounderWeeklyReviewDispatchRow,
    "id" | "companyId" | "runId" | "operationType" | "operationKey" | "eventId" |
    "generationJobId" | "generationClaimId" | "status" | "attemptCount" | "availableAt">;

function toDispatch(row: FounderWeeklyReviewDispatchRow): FounderWeeklyReviewDispatch {
    return row;
}

function identifiers(runId: string, operationType: "create" | "retry", operationKey: string) {
    const suffix = `${operationType}:${operationKey}`;
    return {
        id: `fwrd_${randomUUID()}`,
        eventId: `fwr-event:${runId}:${suffix}`.slice(0, 128),
        generationJobId: `fwr-job:${runId}:${suffix}`.slice(0, 128),
        generationClaimId: `fwr-claim:${runId}:${suffix}`.slice(0, 128),
    };
}

export type FounderWeeklyReviewTransactionClient = Pick<DbClient, "insert" | "select">;
export interface CreateFounderWeeklyReviewDispatchInput {
    run: FounderWeeklyReviewRunRecord;
    operationType: "create" | "retry";
    operationKey: string;
}
export interface FounderWeeklyReviewDispatchServiceDependencies {
    createDispatch?: (transaction: FounderWeeklyReviewTransactionClient, input: CreateFounderWeeklyReviewDispatchInput) => Promise<FounderWeeklyReviewDispatch>;
}

async function createDispatch(
    tx: Pick<DbClient, "insert" | "select">,
    run: FounderWeeklyReviewRunRecord,
    operationType: "create" | "retry",
    operationKey: string,
): Promise<FounderWeeklyReviewDispatch> {
    const ids = identifiers(run.id, operationType, operationKey);
    const [inserted] = await tx.insert(founderWeeklyReviewDispatches).values({
        id: ids.id,
        companyId: run.companyId,
        runId: run.id,
        operationType,
        operationKey,
        eventId: ids.eventId,
        generationJobId: ids.generationJobId,
        generationClaimId: ids.generationClaimId,
        status: "pending",
    }).onConflictDoNothing().returning();
    if (inserted) return toDispatch(inserted);
    const [existing] = await tx.select().from(founderWeeklyReviewDispatches).where(and(
        eq(founderWeeklyReviewDispatches.runId, run.id),
        eq(founderWeeklyReviewDispatches.operationType, operationType),
        eq(founderWeeklyReviewDispatches.operationKey, operationKey),
    )).limit(1);
    if (!existing) throw new Error("Founder weekly review dispatch was not created");
    return toDispatch(existing);
}

export type CreateRunWithDispatchInput = {
    actor: FounderWeeklyReviewUserActor;
    requestKey: string;
    reportingPeriod: ReportingPeriod;
    evidenceSnapshot?: FounderWeeklyReviewEvidenceSnapshot;
    collectionInput?: import("@launchstack/features/founder-weekly-review").FounderWeeklyReviewCollectionInput;
};
export type RetryRunWithDispatchInput = { actor: FounderWeeklyReviewUserActor; runId: string; requestKey: string };
export type CreateRunWithDispatchResult = { run: FounderWeeklyReviewRunRecord; dispatch: FounderWeeklyReviewDispatch; created: boolean };
export type RetryRunWithDispatchResult = { run: FounderWeeklyReviewRunRecord; dispatch: FounderWeeklyReviewDispatch; transitionApplied: boolean };

export function createFounderWeeklyReviewDispatchService(database: Pick<DbClient, "transaction">, dependencies: FounderWeeklyReviewDispatchServiceDependencies = {}) {
    const writeDispatch = dependencies.createDispatch ?? ((transaction, input) => createDispatch(transaction, input.run, input.operationType, input.operationKey));
    const createRunWithDispatch = async (input: CreateRunWithDispatchInput): Promise<CreateRunWithDispatchResult> => database.transaction(async (tx) => {
        const service = new FounderWeeklyReviewUserService(new FounderWeeklyReviewRepository(tx as unknown as DbClient));
        const { run, created } = await service.createOrGetRunWithMetadata(input.actor, input);
        const dispatch = await writeDispatch(tx, { run, operationType: "create", operationKey: input.requestKey });
        return { run, dispatch, created };
    });
    const retryRunWithDispatch = async (input: RetryRunWithDispatchInput): Promise<RetryRunWithDispatchResult> => database.transaction(async (tx) => {
        const service = new FounderWeeklyReviewUserService(new FounderWeeklyReviewRepository(tx as unknown as DbClient));
        const { run, transitionApplied } = await service.retryFailedRunWithMetadata(input.actor, input.runId, input.requestKey);
        const dispatch = await writeDispatch(tx, { run, operationType: "retry", operationKey: input.requestKey });
        return { run, dispatch, transitionApplied };
    });
    return { createRunWithDispatch, retryRunWithDispatch };
}

const productionDispatchService = createFounderWeeklyReviewDispatchService(db);
export const createRunWithDispatch = productionDispatchService.createRunWithDispatch;
export const retryRunWithDispatch = productionDispatchService.retryRunWithDispatch;

export async function claimPendingDispatches(limit = 20): Promise<FounderWeeklyReviewDispatch[]> {
    const now = new Date();
    const staleDispatchingBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const candidates = await db.select({ id: founderWeeklyReviewDispatches.id })
        .from(founderWeeklyReviewDispatches).where(and(
        or(
            and(inArray(founderWeeklyReviewDispatches.status, ["pending", "failed"]), lte(founderWeeklyReviewDispatches.availableAt, now)),
            and(eq(founderWeeklyReviewDispatches.status, "dispatching"), lte(founderWeeklyReviewDispatches.updatedAt, staleDispatchingBefore)),
        ),
    )).limit(limit);
    const claimed: FounderWeeklyReviewDispatch[] = [];
    for (const candidate of candidates) {
        const [row] = await db.update(founderWeeklyReviewDispatches).set({
            status: "dispatching", attemptCount: sql`${founderWeeklyReviewDispatches.attemptCount} + 1`,
            updatedAt: now,
        }).where(and(
            eq(founderWeeklyReviewDispatches.id, candidate.id),
            or(inArray(founderWeeklyReviewDispatches.status, ["pending", "failed"]), and(eq(founderWeeklyReviewDispatches.status, "dispatching"), lte(founderWeeklyReviewDispatches.updatedAt, staleDispatchingBefore))),
        )).returning();
        if (row) claimed.push(toDispatch(row));
    }
    return claimed;
}

export async function markDispatchDispatched(dispatchId: string): Promise<void> {
    await db.update(founderWeeklyReviewDispatches).set({
        status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date(),
    }).where(eq(founderWeeklyReviewDispatches.id, dispatchId));
}

export async function returnDispatchToPending(dispatchId: string, errorCode: string): Promise<void> {
    await db.update(founderWeeklyReviewDispatches).set({
        status: "pending", lastErrorCode: errorCode.slice(0, 128), availableAt: new Date(),
        updatedAt: new Date(),
    }).where(eq(founderWeeklyReviewDispatches.id, dispatchId));
}
