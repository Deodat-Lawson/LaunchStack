import { and, asc, eq, gt, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@launchstack/core/db";

import {
    callNotesWorkItems,
    callNotesWorkItemKindEnum,
    callNotesWorkItemStatusEnum,
    type CallNotesWorkItemRow,
} from "./schema";
import type { CallNotesClock, CallNotesIdSource } from "./ports";

export type CallNotesWorkItemKind = (typeof callNotesWorkItemKindEnum)[number];
export type CallNotesWorkItemStatus = (typeof callNotesWorkItemStatusEnum)[number];

export interface CallNotesWorkItemEnqueueInput {
    companyId: string;
    callId?: string | null;
    captureId?: string | null;
    kind: CallNotesWorkItemKind;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    availableAt?: Date;
}

export interface CallNotesWorkItemClaim
    extends Omit<CallNotesWorkItemRow, "leaseToken" | "leaseOwner" | "leaseExpiresAt"> {
    leaseToken: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    fencingToken: string;
}
export interface CallNotesWorkItemClaimOptions {
    companyId?: string;
    kind?: CallNotesWorkItemKind;
    leaseMs?: number;
    leaseDurationMs?: number;
    now?: Date;
}

export interface CallNotesWorkItemFailure {
    code?: string;
    message?: string;
    availableAt?: Date;
}

export interface CallNotesWorkItemsOptions {
    clock?: CallNotesClock;
    ids?: CallNotesIdSource;
    leaseMs?: number;
    leaseDurationMs?: number;
}

export class CallNotesWorkItemError extends Error {
    readonly code: "not_found" | "stale_token" | "invalid";

    constructor(code: "not_found" | "stale_token" | "invalid", message: string) {
        super(message);
        this.name = "CallNotesWorkItemError";
        this.code = code;
    }
}

const defaultClock: CallNotesClock = { now: () => new Date() };
const defaultIds: CallNotesIdSource = {
    next(prefix: string) {
        return `${prefix}_${randomUUID().replace(/-/g, "")}`;
    },
};

function companyNumber(companyId: string): bigint {
    if (!/^\d+$/.test(companyId)) {
        throw new CallNotesWorkItemError("invalid", `Invalid company id ${companyId}`);
    }
    return BigInt(companyId);
}

function token(ids: CallNotesIdSource): string {
    return ids.next("lease");
}

/**
 * Durable work receipts and fenced leases for Call Notes workers.
 *
 * Claims are serialized by a row lock and SKIP LOCKED, and every reclaim gets
 * a fresh lease token. Completion/failure always checks both the status and
 * token, so a worker that wakes after expiry cannot mutate a reclaimed item.
 */
export class CallNotesWorkItems {
    private readonly clock: CallNotesClock;
    private readonly ids: CallNotesIdSource;
    private readonly defaultLeaseMs: number;

    constructor(
        private readonly db: DbClient,
        options: CallNotesWorkItemsOptions = {}
    ) {
        this.clock = options.clock ?? defaultClock;
        this.ids = options.ids ?? defaultIds;
        this.defaultLeaseMs = options.leaseMs ?? options.leaseDurationMs ?? 30_000;
    }

    async enqueue(
        input: CallNotesWorkItemEnqueueInput,
        executor: DbClient = this.db
    ): Promise<CallNotesWorkItemRow> {
        const now = this.clock.now();
        const values = {
            id: this.ids.next(`work_${input.kind}`),
            companyId: companyNumber(input.companyId),
            callId: input.callId ?? null,
            captureId: input.captureId ?? null,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            status: "pending" as const,
            attempts: 0,
            availableAt: input.availableAt ?? now,
            createdAt: now,
        };
        const [created] = await executor
            .insert(callNotesWorkItems)
            .values(values)
            .onConflictDoNothing({
                target: [
                    callNotesWorkItems.companyId,
                    callNotesWorkItems.kind,
                    callNotesWorkItems.idempotencyKey,
                ],
            })
            .returning();
        if (created) return created;

        const [existing] = await executor
            .select()
            .from(callNotesWorkItems)
            .where(
                and(
                    eq(callNotesWorkItems.companyId, values.companyId),
                    eq(callNotesWorkItems.kind, values.kind),
                    eq(callNotesWorkItems.idempotencyKey, values.idempotencyKey)
                )
            )
            .limit(1);
        if (!existing) {
            throw new CallNotesWorkItemError(
                "not_found",
                `Work item ${input.kind}/${input.idempotencyKey} was not created`
            );
        }
        return existing;
    }

    async get(id: string): Promise<CallNotesWorkItemRow | null> {
        const [row] = await this.db
            .select()
            .from(callNotesWorkItems)
            .where(eq(callNotesWorkItems.id, id))
            .limit(1);
        return row ?? null;
    }

    async claim(
        owner: string,
        options: CallNotesWorkItemClaimOptions = {}
    ): Promise<CallNotesWorkItemClaim | null> {
        if (!owner) throw new CallNotesWorkItemError("invalid", "A lease owner is required");
        const now = options.now ?? this.clock.now();
        const leaseMs = options.leaseMs ?? options.leaseDurationMs ?? this.defaultLeaseMs;
        if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
            throw new CallNotesWorkItemError("invalid", "leaseMs must be positive");
        }
        const company =
            options.companyId === undefined ? undefined : companyNumber(options.companyId);
        return this.db.transaction(async tx => {
            const predicates = [
                or(
                    eq(callNotesWorkItems.status, "pending"),
                    and(
                        eq(callNotesWorkItems.status, "claimed"),
                        lte(callNotesWorkItems.leaseExpiresAt, now)
                    )
                ),
                lte(callNotesWorkItems.availableAt, now),
                ...(company === undefined ? [] : [eq(callNotesWorkItems.companyId, company)]),
                ...(options.kind === undefined ? [] : [eq(callNotesWorkItems.kind, options.kind)]),
            ];
            const [candidate] = await tx
                .select()
                .from(callNotesWorkItems)
                .where(and(...predicates))
                .orderBy(
                    asc(callNotesWorkItems.availableAt),
                    asc(callNotesWorkItems.createdAt),
                    asc(callNotesWorkItems.id)
                )
                .for("update", { skipLocked: true })
                .limit(1);
            if (!candidate) return null;

            const leaseToken = token(this.ids);
            const leaseExpiresAt = new Date(now.getTime() + leaseMs);
            const [claimed] = await tx
                .update(callNotesWorkItems)
                .set({
                    status: "claimed",
                    leaseToken,
                    leaseOwner: owner,
                    leaseExpiresAt,
                    attempts: candidate.attempts + 1,
                })
                .where(eq(callNotesWorkItems.id, candidate.id))
                .returning();
            if (!claimed || !claimed.leaseToken || !claimed.leaseOwner || !claimed.leaseExpiresAt) {
                throw new CallNotesWorkItemError(
                    "invalid",
                    `Unable to claim work item ${candidate.id}`
                );
            }
            return {
                ...claimed,
                leaseToken: claimed.leaseToken,
                leaseOwner: claimed.leaseOwner,
                leaseExpiresAt: claimed.leaseExpiresAt,
                fencingToken: claimed.leaseToken,
            };
        });
    }

    /**
     * Claims one specific receipt with the same lease/fencing semantics as a
     * worker claim. This is used by provider event delivery, where duplicate
     * deliveries must not both apply the event.
     */
    async claimById(
        id: string,
        owner: string,
        options: CallNotesWorkItemClaimOptions = {}
    ): Promise<CallNotesWorkItemClaim | null> {
        if (!id || !owner) {
            throw new CallNotesWorkItemError(
                "invalid",
                "A receipt id and lease owner are required"
            );
        }
        const now = options.now ?? this.clock.now();
        const leaseMs = options.leaseMs ?? options.leaseDurationMs ?? this.defaultLeaseMs;
        if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
            throw new CallNotesWorkItemError("invalid", "leaseMs must be positive");
        }
        const company =
            options.companyId === undefined ? undefined : companyNumber(options.companyId);
        return this.db.transaction(async tx => {
            const [candidate] = await tx
                .select()
                .from(callNotesWorkItems)
                .where(
                    and(
                        eq(callNotesWorkItems.id, id),
                        or(
                            eq(callNotesWorkItems.status, "pending"),
                            and(
                                eq(callNotesWorkItems.status, "claimed"),
                                lte(callNotesWorkItems.leaseExpiresAt, now)
                            )
                        ),
                        lte(callNotesWorkItems.availableAt, now),
                        ...(company === undefined
                            ? []
                            : [eq(callNotesWorkItems.companyId, company)]),
                        ...(options.kind === undefined
                            ? []
                            : [eq(callNotesWorkItems.kind, options.kind)])
                    )
                )
                .for("update", { skipLocked: true })
                .limit(1);
            if (!candidate) return null;

            const leaseToken = token(this.ids);
            const leaseExpiresAt = new Date(now.getTime() + leaseMs);
            const [claimed] = await tx
                .update(callNotesWorkItems)
                .set({
                    status: "claimed",
                    leaseToken,
                    leaseOwner: owner,
                    leaseExpiresAt,
                    attempts: candidate.attempts + 1,
                })
                .where(
                    and(
                        eq(callNotesWorkItems.id, candidate.id),
                        or(
                            eq(callNotesWorkItems.status, "pending"),
                            and(
                                eq(callNotesWorkItems.status, "claimed"),
                                lte(callNotesWorkItems.leaseExpiresAt, now)
                            )
                        )
                    )
                )
                .returning();
            if (!claimed || !claimed.leaseToken || !claimed.leaseOwner || !claimed.leaseExpiresAt) {
                throw new CallNotesWorkItemError(
                    "invalid",
                    `Unable to claim work item ${candidate.id}`
                );
            }
            return {
                ...claimed,
                leaseToken: claimed.leaseToken,
                leaseOwner: claimed.leaseOwner,
                leaseExpiresAt: claimed.leaseExpiresAt,
                fencingToken: claimed.leaseToken,
            };
        });
    }

    async claimNext(
        owner: string,
        options: CallNotesWorkItemClaimOptions = {}
    ): Promise<CallNotesWorkItemClaim | null> {
        return this.claim(owner, options);
    }

    async complete(id: string, leaseToken: string): Promise<CallNotesWorkItemRow> {
        const [updated] = await this.db
            .update(callNotesWorkItems)
            .set({
                status: "completed",
                completedAt: this.clock.now(),
                leaseToken: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                errorCode: null,
                errorMessage: null,
            })
            .where(
                and(
                    eq(callNotesWorkItems.id, id),
                    eq(callNotesWorkItems.status, "claimed"),
                    eq(callNotesWorkItems.leaseToken, leaseToken),
                    gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
                )
            )
            .returning();
        if (updated) return updated;
        await this.assertToken(id, leaseToken);
        throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
    }

    async fail(
        id: string,
        leaseToken: string,
        failure: CallNotesWorkItemFailure = {}
    ): Promise<CallNotesWorkItemRow> {
        const [updated] = await this.db
            .update(callNotesWorkItems)
            .set({
                status: "failed",
                errorCode: failure.code ?? "work_item_failed",
                errorMessage: failure.message ?? null,
                availableAt: failure.availableAt ?? this.clock.now(),
                leaseToken: null,
                leaseOwner: null,
                leaseExpiresAt: null,
            })
            .where(
                and(
                    eq(callNotesWorkItems.id, id),
                    eq(callNotesWorkItems.status, "claimed"),
                    eq(callNotesWorkItems.leaseToken, leaseToken),
                    gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
                )
            )
            .returning();
        if (updated) return updated;
        await this.assertToken(id, leaseToken);
        throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
    }

    async release(
        id: string,
        leaseToken: string,
        availableAt = this.clock.now()
    ): Promise<CallNotesWorkItemRow> {
        const [updated] = await this.db
            .update(callNotesWorkItems)
            .set({
                status: "pending",
                availableAt,
                leaseToken: null,
                leaseOwner: null,
                leaseExpiresAt: null,
            })
            .where(
                and(
                    eq(callNotesWorkItems.id, id),
                    eq(callNotesWorkItems.status, "claimed"),
                    eq(callNotesWorkItems.leaseToken, leaseToken),
                    gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
                )
            )
            .returning();
        if (updated) return updated;
        await this.assertToken(id, leaseToken);
        throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
    }

    /** Marks a command/event receipt complete without taking a worker lease. */
    async completeReceipt(
        id: string,
        payload: Record<string, unknown>
    ): Promise<CallNotesWorkItemRow> {
        const [updated] = await this.db
            .update(callNotesWorkItems)
            .set({ status: "completed", payload, completedAt: this.clock.now() })
            .where(eq(callNotesWorkItems.id, id))
            .returning();
        if (!updated) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
        return updated;
    }

    async reopenReceipt(id: string): Promise<CallNotesWorkItemRow> {
        const [updated] = await this.db
            .update(callNotesWorkItems)
            .set({ status: "pending", errorCode: null, errorMessage: null, completedAt: null })
            .where(eq(callNotesWorkItems.id, id))
            .returning();
        if (!updated) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
        return updated;
    }

    private async assertToken(id: string, leaseToken: string): Promise<void> {
        const row = await this.get(id);
        if (!row) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
        if (row.leaseToken !== leaseToken || row.status !== "claimed") {
            throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
        }
    }
}

export const PostgresCallNotesWorkItems = CallNotesWorkItems;

export function createPostgresCallNotesWorkItems(
    db: DbClient,
    options?: CallNotesWorkItemsOptions
): CallNotesWorkItems;
export function createPostgresCallNotesWorkItems(
    options: CallNotesWorkItemsOptions & { db: DbClient }
): CallNotesWorkItems;
export function createPostgresCallNotesWorkItems(
    dbOrOptions: DbClient | (CallNotesWorkItemsOptions & { db: DbClient }),
    options: CallNotesWorkItemsOptions = {}
): CallNotesWorkItems {
    if ("db" in dbOrOptions) {
        const { db, ...workOptions } = dbOrOptions;
        return new CallNotesWorkItems(db, workOptions);
    }
    return new CallNotesWorkItems(dbOrOptions, options);
}
