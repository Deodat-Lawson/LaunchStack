import { and, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import { company, eventOutbox } from "@launchstack/store/schema";
import { enqueueOutboxEventsWithRevive } from "@launchstack/orchestration";
import { eventIds, PROTOCOL_VERSION } from "@launchstack/orchestration/pipeline-events";

import {
    storageDeletionItems,
    storageDeletionRequests,
    type StorageDeletionItem,
    type StorageDeletionRequest,
} from "~/server/db/schema/storage";
import type { Executor } from "~/server/workspace/db-types";
import { recomputeDeletionRequestStatus, storageDeletionOperationalState } from "./status";

type ItemCounts = Record<StorageDeletionItem["state"], number>;
const emptyItemCounts = (): ItemCounts => ({
    pending: 0,
    deleted: 0,
    not_found: 0,
    retained: 0,
    blocked: 0,
    quarantined: 0,
    skipped: 0,
    waived: 0,
});

const deletionDeliveryJoin = eq(
    eventOutbox.eventId,
    sql`'storage.deletion.requested:' || ${storageDeletionRequests.id}::text`
);

export async function getStorageDeletionSummary(db: Executor) {
    const requestRows = await db
        .select({
            status: storageDeletionRequests.status,
            outboxStatus: eventOutbox.status,
            count: count(),
        })
        .from(storageDeletionRequests)
        .leftJoin(eventOutbox, deletionDeliveryJoin)
        .groupBy(storageDeletionRequests.status, eventOutbox.status);
    const itemRows = await db
        .select({ state: storageDeletionItems.state, count: count() })
        .from(storageDeletionItems)
        .groupBy(storageDeletionItems.state);
    const [age] = await db
        .select({
            seconds: sql<
                number | null
            >`extract(epoch from (CURRENT_TIMESTAMP - min(${storageDeletionItems.createdAt})))`.mapWith(
                Number
            ),
        })
        .from(storageDeletionItems)
        .where(eq(storageDeletionItems.state, "pending"));
    const [dead] = await db
        .select({ count: count() })
        .from(eventOutbox)
        .where(
            and(
                eq(eventOutbox.eventType, "storage.deletion.requested"),
                eq(eventOutbox.status, "dead")
            )
        );
    const requestsByStatus: Record<StorageDeletionRequest["status"], number> = {
        pending: 0,
        completed: 0,
        blocked: 0,
    };
    for (const row of requestRows) {
        const operational = await storageDeletionOperationalState(
            db,
            { id: 0, status: row.status },
            row.outboxStatus === null ? null : { status: row.outboxStatus }
        );
        requestsByStatus[operational.status] += row.count;
    }
    const itemsByState = emptyItemCounts();
    for (const row of itemRows) itemsByState[row.state] = row.count;
    return {
        requestsByStatus,
        itemsByState,
        oldestPendingAgeSeconds:
            age?.seconds === null || age?.seconds === undefined
                ? null
                : Math.max(0, Number(age.seconds)),
        blockedItems: itemsByState.blocked,
        quarantinedItems: itemsByState.quarantined,
        deadOutboxEvents: dead?.count ?? 0,
    };
}

export async function listStorageDeletionRequests(
    db: Executor,
    options: { status: "blocked" | "pending"; companyId?: bigint; limit?: number }
) {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new Error("limit must be a positive integer");
    if (options.status !== "blocked" && options.status !== "pending")
        throw new Error("status must be blocked or pending");
    const requests = await db
        .select({ request: storageDeletionRequests, delivery: { status: eventOutbox.status } })
        .from(storageDeletionRequests)
        .leftJoin(eventOutbox, deletionDeliveryJoin)
        .where(
            and(
                options.status === "blocked"
                    ? or(
                          eq(storageDeletionRequests.status, "blocked"),
                          and(
                              eq(storageDeletionRequests.status, "pending"),
                              or(isNull(eventOutbox.status), eq(eventOutbox.status, "dead"))
                          )
                      )
                    : and(
                          eq(storageDeletionRequests.status, "pending"),
                          ne(eventOutbox.status, "dead")
                      ),
                options.companyId === undefined
                    ? undefined
                    : eq(storageDeletionRequests.companyId, options.companyId)
            )
        )
        .orderBy(asc(storageDeletionRequests.createdAt), asc(storageDeletionRequests.id))
        .limit(limit);
    if (!requests.length) return [];
    const counts = await db
        .select({
            requestId: storageDeletionItems.requestId,
            state: storageDeletionItems.state,
            count: count(),
        })
        .from(storageDeletionItems)
        .where(
            inArray(
                storageDeletionItems.requestId,
                requests.map(row => row.request.id)
            )
        )
        .groupBy(storageDeletionItems.requestId, storageDeletionItems.state);
    const byRequest = new Map<number, ItemCounts>();
    for (const row of counts) {
        let breakdown = byRequest.get(row.requestId);
        if (!breakdown) {
            breakdown = emptyItemCounts();
            byRequest.set(row.requestId, breakdown);
        }
        breakdown[row.state] = row.count;
    }
    return Promise.all(
        requests.map(async row => {
            const operational = await storageDeletionOperationalState(
                db,
                row.request,
                row.delivery
            );
            return {
                request: row.request,
                operationalStatus: operational.status,
                errorCode: operational.errorCode,
                outboxStatus: row.delivery?.status ?? null,
                itemsByState: byRequest.get(row.request.id) ?? emptyItemCounts(),
            };
        })
    );
}

export async function showStorageDeletionRequest(db: Executor, requestId: number) {
    const [row] = await db
        .select({ request: storageDeletionRequests, delivery: { status: eventOutbox.status } })
        .from(storageDeletionRequests)
        .leftJoin(eventOutbox, deletionDeliveryJoin)
        .where(eq(storageDeletionRequests.id, requestId));
    if (!row) throw new Error(`Storage deletion request ${requestId} not found`);
    const items = await db
        .select()
        .from(storageDeletionItems)
        .where(eq(storageDeletionItems.requestId, requestId))
        .orderBy(asc(storageDeletionItems.id));
    const operational = await storageDeletionOperationalState(db, row.request, row.delivery);
    return {
        request: row.request,
        operationalStatus: operational.status,
        errorCode: operational.errorCode,
        outboxStatus: row.delivery?.status ?? null,
        items,
    };
}

/** Own the transaction so the audit line is emitted only after its commit succeeds. */
export async function requeueStorageDeletionRequest(
    db: DbClient,
    requestId: number,
    input: { actor: string; note?: string }
) {
    const actor = input.actor.trim();
    if (!actor || actor.length > 256)
        throw new Error("actor is required and must be at most 256 characters");
    const note = input.note?.trim().length
        ? input.note.trim()
        : "Operator requeued storage deletion after remediation";
    const result = await db.transaction(async tx => {
        const [request] = await tx
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, requestId))
            .for("update");
        if (!request) throw new Error(`Storage deletion request ${requestId} not found`);
        if (request.status === "completed")
            throw new Error(`Storage deletion request ${requestId} is completed`);
        const items = await tx
            .select()
            .from(storageDeletionItems)
            .where(eq(storageDeletionItems.requestId, requestId))
            .orderBy(asc(storageDeletionItems.id))
            .for("update");
        const [event] = await tx
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(requestId)))
            .for("update");
        if (event?.status === "processing")
            throw new Error(
                `Storage deletion request ${requestId}: delivery in flight, retry shortly`
            );
        const skippedItemIds = items
            .filter(item => item.errorCode === "foreign_object")
            .map(item => item.id);
        if (!event) {
            // Keep the tenant alive until the event's company FK has been inserted.
            const [tenant] = await tx
                .select({ id: company.id })
                .from(company)
                .where(eq(company.id, Number(request.companyId)))
                .for("key share");
            if (!tenant)
                throw Object.assign(
                    new Error(
                        `Storage deletion request ${requestId}: company no longer exists; use waive to resolve undeleted items. Skipped foreign_object item IDs: ${skippedItemIds.join(", ") || "none"}`
                    ),
                    { skippedItemIds }
                );
        }
        const dead = event?.status === "dead";
        const stranded = !event || dead;
        const changedItemIds = items
            .filter(
                item =>
                    item.errorCode !== "foreign_object" &&
                    ((stranded && item.state === "pending") ||
                        (item.state === "blocked" &&
                            (item.errorCode === "retry_budget_exhausted" ||
                                // Other blocked outcomes with a ref and code are provider-classified.
                                (item.adapter !== null &&
                                    item.storageLocationId !== null &&
                                    item.objectKey !== null &&
                                    item.errorCode !== null))))
            )
            .map(item => item.id);
        if (changedItemIds.length) {
            const now = new Date();
            await tx
                .update(storageDeletionItems)
                .set({
                    state: "pending",
                    attempts: 0,
                    errorCode: null,
                    lastError: null,
                    requeuedBy: actor,
                    requeueNote: note,
                    requeuedAt: now,
                    updatedAt: now,
                })
                .where(inArray(storageDeletionItems.id, changedItemIds));
        }
        if (changedItemIds.length) {
            await tx
                .update(storageDeletionRequests)
                .set({ status: "pending", completedAt: null, updatedAt: new Date() })
                .where(eq(storageDeletionRequests.id, requestId));
        }
        await enqueueOutboxEventsWithRevive(tx, [
            {
                eventId: eventIds.storageDeletionRequested(requestId),
                eventType: "storage.deletion.requested",
                schemaVersion: PROTOCOL_VERSION,
                occurredAt: new Date().toISOString(),
                traceId: request.traceId,
                companyId: Number(request.companyId),
                payload: { requestId },
            },
        ]);
        return {
            requestId,
            changedItemIds,
            skippedItemIds,
            revivedDeadEvent: dead,
            recreatedMissingEvent: !event,
            traceId: request.traceId,
        };
    });
    console.error(
        JSON.stringify({
            event: "storage_deletion_admin",
            action: "requeue",
            actor,
            note,
            ...result,
            at: new Date().toISOString(),
        })
    );
    return result;
}

/** Waiving accepts undeleted bytes; it never invokes a provider or alters a terminal outcome. */
export async function waiveStorageDeletionItem(
    db: DbClient,
    itemId: number,
    input: { actor: string; note: string }
) {
    const actor = input.actor.trim();
    const note = input.note.trim();
    if (!actor || actor.length > 256)
        throw new Error("actor is required and must be at most 256 characters");
    if (!note) throw new Error("note is required");
    const result = await db.transaction(async tx => {
        // This non-locking lookup finds the parent; lock order is always request then items.
        const [lookup] = await tx
            .select({ requestId: storageDeletionItems.requestId })
            .from(storageDeletionItems)
            .where(eq(storageDeletionItems.id, itemId));
        if (!lookup) throw new Error(`Storage deletion item ${itemId} not found`);
        const [request] = await tx
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, lookup.requestId))
            .for("update");
        if (!request) throw new Error(`Storage deletion request ${lookup.requestId} not found`);
        if (request.status === "completed")
            throw new Error(`Storage deletion request ${request.id} is completed`);
        const items = await tx
            .select()
            .from(storageDeletionItems)
            .where(eq(storageDeletionItems.requestId, request.id))
            .orderBy(asc(storageDeletionItems.id))
            .for("update");
        const item = items.find(row => row.id === itemId);
        if (!item) throw new Error(`Storage deletion item ${itemId} not found`);
        if (item.state === "waived")
            return {
                requestId: request.id,
                itemId,
                changedItemIds: [] as number[],
                status: request.status,
                traceId: request.traceId,
            };
        if (item.state === "pending") {
            const [delivery] = await tx
                .select({ status: eventOutbox.status })
                .from(eventOutbox)
                .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(request.id)))
                .for("update");
            const operational = await storageDeletionOperationalState(
                tx,
                request,
                delivery ?? null
            );
            if (
                operational.status !== "blocked" ||
                (operational.errorCode !== "event_missing" &&
                    operational.errorCode !== "event_dead")
            )
                throw new Error(
                    `Storage deletion item ${itemId} must be blocked or quarantined; pending items require event_missing or event_dead`
                );
        } else if (item.state !== "blocked" && item.state !== "quarantined") {
            throw new Error(`Storage deletion item ${itemId} must be blocked or quarantined`);
        }
        const now = new Date();
        await tx
            .update(storageDeletionItems)
            .set({
                state: "waived",
                resolvedBy: actor,
                resolutionNote: note,
                resolvedAt: now,
                updatedAt: now,
            })
            .where(eq(storageDeletionItems.id, itemId));
        const { status } = await recomputeDeletionRequestStatus(tx, request.id);
        if (status === "completed") {
            await tx
                .update(eventOutbox)
                .set({ status: "processed", processedAt: now, lastError: null })
                .where(
                    and(
                        eq(eventOutbox.eventId, eventIds.storageDeletionRequested(request.id)),
                        eq(eventOutbox.status, "dead")
                    )
                );
        }
        return {
            requestId: request.id,
            itemId,
            changedItemIds: [itemId],
            status,
            traceId: request.traceId,
        };
    });
    console.error(
        JSON.stringify({
            event: "storage_deletion_admin",
            action: "waive",
            actor,
            note,
            ...result,
            at: new Date().toISOString(),
        })
    );
    return result;
}
