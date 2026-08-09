import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import type { DbClient } from "@launchstack/core/db";
import {
    founderWeeklyReviewDispatches,
    type FounderWeeklyReviewDispatchRow,
} from "~/server/db/schema";
import {
    FounderWeeklyReviewRepository,
    FounderWeeklyReviewUserService,
    type FounderWeeklyReviewRunRecord,
    type FounderWeeklyReviewUserActor,
    type ReportingPeriod,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewCollectionInput,
} from "@launchstack/features/founder-weekly-review";

export type FounderWeeklyReviewDispatch = Pick<FounderWeeklyReviewDispatchRow,
    "id" | "companyId" | "runId" | "operationType" | "operationKey" | "eventId" |
    "generationJobId" | "generationClaimId" | "status" | "attemptCount" | "availableAt">;

function toDispatch(row: FounderWeeklyReviewDispatchRow): FounderWeeklyReviewDispatch {
    return row;
}

/**
 * Identifiers derived from the operation, not truncated from it.
 *
 * A run id is up to 64 characters and an operation key up to 128, so the
 * readable form overflows the 128-character columns. Slicing it off the end
 * cut into the operation key: two different keys sharing a prefix produced the
 * SAME event id, and since that id is the Inngest idempotency key, the second
 * operation was silently swallowed as a duplicate. Hashing the whole tuple
 * keeps every identifier distinct and comfortably inside the column.
 */
function identifiers(runId: string, operationType: "create" | "retry", operationKey: string) {
    const fingerprint = createHash("sha256")
        .update(runId)
        .update("\0")
        .update(operationType)
        .update("\0")
        .update(operationKey)
        .digest("hex");
    return {
        id: `fwrd_${randomUUID()}`,
        eventId: `fwr-event:${fingerprint}`,
        generationJobId: `fwr-job:${fingerprint}`,
        generationClaimId: `fwr-claim:${fingerprint}`,
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
    collectionInput?: FounderWeeklyReviewCollectionInput;
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

/**
 * The claim runs as raw SQL (the query builder cannot express
 * `FOR UPDATE SKIP LOCKED` inside a CTE), so the driver hands back database
 * column names and untyped numerics rather than the mapped row.
 */
interface RawDispatchRow extends Record<string, unknown> {
    id: string;
    company_id: string | number | bigint;
    run_id: string;
    operation_type: FounderWeeklyReviewDispatchRow["operationType"];
    operation_key: string;
    event_id: string;
    generation_job_id: string;
    generation_claim_id: string;
    status: FounderWeeklyReviewDispatchRow["status"];
    attempt_count: number | string;
    available_at: Date | string;
}

function mapDispatchRow(row: RawDispatchRow): FounderWeeklyReviewDispatch {
    return {
        id: row.id,
        companyId: BigInt(row.company_id),
        runId: row.run_id,
        operationType: row.operation_type,
        operationKey: row.operation_key,
        eventId: row.event_id,
        generationJobId: row.generation_job_id,
        generationClaimId: row.generation_claim_id,
        status: row.status,
        attemptCount: Number(row.attempt_count),
        availableAt:
            row.available_at instanceof Date
                ? row.available_at
                : new Date(row.available_at),
    };
}

export const DISPATCH_CLAIM_BATCH_SIZE = 20;

/** A dispatching row older than this is assumed abandoned and reclaimable. */
const STALE_DISPATCHING_MS = 5 * 60 * 1000;

/**
 * Retry policy for a dispatch whose send failed.
 *
 * The statuses mean:
 *   pending     due at `available_at`; the only state a claim picks up
 *   dispatching in flight, reclaimable once stale
 *   dispatched  delivered, terminal
 *   failed      attempts exhausted, terminal — never reclaimed
 *
 * `failed` used to be reclaimable and a failure reset `available_at` to now,
 * so an Inngest outage span became a hot loop: claim the batch, fail every
 * send, make all twenty immediately due again, chain another drain, repeat
 * without pause. Backoff plus a terminal state is what bounds that.
 */
export const MAX_DISPATCH_ATTEMPTS = 8;
const DISPATCH_BACKOFF_BASE_MS = 5_000;
/** Cap the delay so a recovered endpoint is retried promptly, not hours later. */
const DISPATCH_BACKOFF_MAX_MS = 15 * 60 * 1000;

/** Delay before the nth attempt becomes due again: 5s, 10s, 20s … 15m. */
export function dispatchBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(DISPATCH_BACKOFF_BASE_MS * 2 ** exponent, DISPATCH_BACKOFF_MAX_MS);
}

/**
 * Claim a batch of due dispatches, atomically.
 *
 * One statement, `FOR UPDATE SKIP LOCKED`: concurrent dispatchers step over
 * each other's locked rows and take different work. The previous
 * select-then-update-each version let every concurrent invocation read the same
 * first 20 candidates and then lose all but one of the updates, so a backlog
 * drained one batch per dispatcher instead of one batch per invocation, and the
 * remainder waited on the five-minute reconciler.
 *
 * Ordered by `available_at, created_at` so a retry that has come due is never
 * starved by newer work, and so the order is deterministic under contention.
 */
export async function claimPendingDispatches(
    limit = DISPATCH_CLAIM_BATCH_SIZE,
): Promise<FounderWeeklyReviewDispatch[]> {
    // Bound as ISO strings with an explicit cast: on the raw-SQL path there is
    // no column definition to tell the driver how to encode a Date, and it
    // rejects one outright.
    const now = new Date().toISOString();
    const staleDispatchingBefore = new Date(
        Date.now() - STALE_DISPATCHING_MS,
    ).toISOString();

    const rows = await db.execute<RawDispatchRow>(sql`
        WITH claimed AS (
            SELECT "id"
            FROM ${founderWeeklyReviewDispatches}
            WHERE (
                ("status" = 'pending' AND "available_at" <= ${now}::timestamptz)
                OR ("status" = 'dispatching' AND "updated_at" <= ${staleDispatchingBefore}::timestamptz)
            )
            ORDER BY "available_at" ASC, "created_at" ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE ${founderWeeklyReviewDispatches} AS d
        SET "status" = 'dispatching',
            "attempt_count" = d."attempt_count" + 1,
            "updated_at" = ${now}::timestamptz
        FROM claimed
        WHERE d."id" = claimed."id"
        RETURNING d.*
    `);

    return [...rows].map(mapDispatchRow);
}

export async function markDispatchDispatched(dispatchId: string): Promise<void> {
    await db.update(founderWeeklyReviewDispatches).set({
        status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date(),
    }).where(eq(founderWeeklyReviewDispatches.id, dispatchId));
}

export interface DispatchFailureOutcome {
    /** `pending` means it will be retried after the backoff; `failed` is terminal. */
    status: "pending" | "failed";
    attemptCount: number;
    availableAt: Date;
}

/**
 * Record a failed send: back the row off, or retire it once attempts run out.
 *
 * The backoff is computed in SQL from the row's own `attempt_count` so the
 * decision is a single atomic statement — reading the count and then writing
 * would race a concurrent reclaim of the same row and could reset the delay.
 */
export async function recordDispatchFailure(
    dispatchId: string,
    errorCode: string,
): Promise<DispatchFailureOutcome | null> {
    const now = new Date().toISOString();
    const rows = await db.execute<{
        status: "pending" | "failed";
        attempt_count: number | string;
        available_at: Date | string;
    }>(sql`
        UPDATE ${founderWeeklyReviewDispatches}
        SET "status" = CASE
                WHEN "attempt_count" >= ${MAX_DISPATCH_ATTEMPTS} THEN 'failed'
                ELSE 'pending'
            END,
            "last_error_code" = ${errorCode.slice(0, 128)},
            "available_at" = ${now}::timestamptz + (
                LEAST(
                    ${DISPATCH_BACKOFF_BASE_MS} * POWER(2, GREATEST("attempt_count" - 1, 0)),
                    ${DISPATCH_BACKOFF_MAX_MS}
                ) * interval '1 millisecond'
            ),
            "updated_at" = ${now}::timestamptz
        WHERE "id" = ${dispatchId}
        RETURNING "status", "attempt_count", "available_at"
    `);

    const row = [...rows][0];
    if (!row) return null;
    return {
        status: row.status,
        attemptCount: Number(row.attempt_count),
        availableAt:
            row.available_at instanceof Date
                ? row.available_at
                : new Date(row.available_at),
    };
}
