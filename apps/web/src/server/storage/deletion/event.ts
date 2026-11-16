import { enqueueOutboxEventsWithRevive } from "@launchstack/orchestration";
import { eventIds, PROTOCOL_VERSION } from "@launchstack/orchestration/pipeline-events";

import type { Tx } from "~/server/workspace/db-types";

/** Enqueues the worker's event for a request, reviving it if it already exists. */
export async function enqueueStorageDeletionRequested(
    tx: Tx,
    request: { id: number; traceId: string; companyId: bigint | number }
): Promise<void> {
    await enqueueOutboxEventsWithRevive(tx, [
        {
            eventId: eventIds.storageDeletionRequested(request.id),
            eventType: "storage.deletion.requested",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: new Date().toISOString(),
            traceId: request.traceId,
            companyId: Number(request.companyId),
            payload: { requestId: request.id },
        },
    ]);
}
