import { eq } from "drizzle-orm";
import { eventOutbox, type EventOutboxRow } from "@launchstack/store/schema";
import { eventIds } from "@launchstack/orchestration/pipeline-events";

import {
    storageDeletionItems,
    storageDeletionRequests,
    type StorageDeletionItem,
    type StorageDeletionRequest,
} from "~/server/db/schema/storage";
import type { Executor, Tx } from "~/server/workspace/db-types";

export interface StorageDeletionOperationalState {
    status: StorageDeletionRequest["status"];
    errorCode: "event_missing" | "event_dead" | null;
}

/** Delivery health is operational state, not durable outcomes. A null delivery status means the event is missing. */
export function operationalStateOf(
    requestStatus: StorageDeletionRequest["status"],
    deliveryStatus: EventOutboxRow["status"] | null
): StorageDeletionOperationalState {
    if (requestStatus === "completed") return { status: "completed", errorCode: null };
    if (deliveryStatus === null && requestStatus === "pending")
        return { status: "blocked", errorCode: "event_missing" };
    if (deliveryStatus === "dead") return { status: "blocked", errorCode: "event_dead" };
    return { status: requestStatus, errorCode: null };
}

/** Pass null for a known-missing delivery; omit it to query the request's event. */
export async function storageDeletionOperationalState(
    tx: Executor,
    request: Pick<StorageDeletionRequest, "id" | "status">,
    delivery?: Pick<EventOutboxRow, "status"> | null
): Promise<StorageDeletionOperationalState> {
    if (delivery === undefined && request.status !== "completed") {
        [delivery] = await tx
            .select({ status: eventOutbox.status })
            .from(eventOutbox)
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(request.id)));
    }
    return operationalStateOf(request.status, delivery?.status ?? null);
}

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
