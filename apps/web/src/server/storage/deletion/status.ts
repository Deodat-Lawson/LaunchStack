import { eq } from "drizzle-orm";
import { eventOutbox } from "@launchstack/store/schema";
import { eventIds } from "@launchstack/orchestration/pipeline-events";

import type { StorageDeletionRequest } from "~/server/db/schema/storage";
import type { Executor } from "~/server/workspace/db-types";

/** Delivery health is operational state, not a rewrite of durable item outcomes. */
export async function storageDeletionOperationalState(
    tx: Executor,
    request: Pick<StorageDeletionRequest, "id" | "status">
): Promise<{
    status: StorageDeletionRequest["status"];
    errorCode: "event_missing" | "event_dead" | null;
}> {
    if (request.status === "completed") return { status: "completed", errorCode: null };
    const [event] = await tx
        .select({ status: eventOutbox.status })
        .from(eventOutbox)
        .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(request.id)));
    if (!event && request.status === "pending")
        return { status: "blocked", errorCode: "event_missing" };
    if (event?.status === "dead") return { status: "blocked", errorCode: "event_dead" };
    return { status: request.status, errorCode: null };
}
