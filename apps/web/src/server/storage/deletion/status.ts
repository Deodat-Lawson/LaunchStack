import { eq } from "drizzle-orm";
import { eventOutbox } from "@launchstack/store/schema";
import { eventIds } from "@launchstack/orchestration/pipeline-events";

import {
    storageDeletionItems,
    storageDeletionRequests,
    type StorageDeletionItem,
    type StorageDeletionRequest,
} from "~/server/db/schema/storage";
import type { Executor, Tx } from "~/server/workspace/db-types";

/** Delivery health is operational state, not durable outcomes. Pass null for known missing; omit to query. */
export async function storageDeletionOperationalState(
    tx: Executor,
    request: Pick<StorageDeletionRequest, "id" | "status">,
    delivery?: Pick<typeof eventOutbox.$inferSelect, "status"> | null
): Promise<{
    status: StorageDeletionRequest["status"];
    errorCode: "event_missing" | "event_dead" | null;
}> {
    if (request.status === "completed") return { status: "completed", errorCode: null };
    const event =
        delivery === undefined
            ? (
                  await tx
                      .select({ status: eventOutbox.status })
                      .from(eventOutbox)
                      .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(request.id)))
              )[0]
            : delivery;
    if (!event && request.status === "pending")
        return { status: "blocked", errorCode: "event_missing" };
    if (event?.status === "dead") return { status: "blocked", errorCode: "event_dead" };
    return { status: request.status, errorCode: null };
}

/** Call in a transaction; the request lock serializes worker/operator decisions. */
export async function recomputeDeletionRequestStatus(
    tx: Tx,
    requestId: number
): Promise<{
    states: StorageDeletionItem["state"][];
    status: StorageDeletionRequest["status"];
    previousStatus: StorageDeletionRequest["status"];
}> {
    const [request] = await tx
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.id, requestId))
        .for("update");
    if (!request) throw new Error(`Storage deletion request ${requestId} not found`);
    const items = await tx
        .select({ state: storageDeletionItems.state })
        .from(storageDeletionItems)
        .where(eq(storageDeletionItems.requestId, requestId));
    const states = items.map(item => item.state);
    const status = states.includes("pending")
        ? "pending"
        : states.some(state => state === "blocked" || state === "quarantined")
          ? "blocked"
          : "completed";
    const now = new Date();
    await tx
        .update(storageDeletionRequests)
        .set({
            status,
            updatedAt: now,
            completedAt: status === "completed" ? (request.completedAt ?? now) : null,
        })
        .where(eq(storageDeletionRequests.id, requestId));
    return { states, status, previousStatus: request.status };
}
