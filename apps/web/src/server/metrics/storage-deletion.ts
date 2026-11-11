import { Counter, Gauge } from "prom-client";
import { sql } from "drizzle-orm";

import { storageDeletionItems, storageDeletionRequests } from "~/server/db/schema/storage";
import type { Executor } from "~/server/workspace/db-types";
import { metricsRegistry } from "./registry";

export const storageDeletionItemsProcessed = new Counter({
    name: "pdr_storage_deletion_items_processed_total",
    help: "Committed storage deletion item outcomes (retryable attempts included)",
    labelNames: ["outcome"],
    registers: [metricsRegistry],
});

export const storageDeletionRequestsFinished = new Counter({
    name: "pdr_storage_deletion_requests_finished_total",
    help: "Worker transitions of storage deletion requests to completed or blocked",
    labelNames: ["status"],
    registers: [metricsRegistry],
});

export const storageDeletionPendingItems = new Gauge({
    name: "pdr_storage_deletion_pending_items",
    help: "Pending storage deletion items at the last worker refresh",
    registers: [metricsRegistry],
});

export const storageDeletionOldestPendingAge = new Gauge({
    name: "pdr_storage_deletion_oldest_pending_age_seconds",
    help: "Age of the oldest pending request at the last worker refresh",
    registers: [metricsRegistry],
});

export async function refreshStorageDeletionBacklog(db: Executor): Promise<void> {
    try {
        const [backlog] = await db.execute<{ pending: number; oldest: number }>(sql`
            SELECT
                (SELECT count(*)::integer FROM ${storageDeletionItems} WHERE state = 'pending') AS pending,
                (SELECT COALESCE(GREATEST(0, extract(epoch FROM now() - min(created_at))), 0)::double precision
                 FROM ${storageDeletionRequests} WHERE status = 'pending') AS oldest
        `);
        storageDeletionPendingItems.set(backlog?.pending ?? 0);
        storageDeletionOldestPendingAge.set(backlog?.oldest ?? 0);
    } catch (error) {
        console.error("[storage-deletion] backlog metrics refresh failed:", error);
    }
}
