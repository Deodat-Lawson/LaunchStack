import { inArray, eq } from "drizzle-orm";

import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
} from "@launchstack/core/db/schema";
import { db } from "~/server/db";
import { getStorageDeletionFlagState } from "~/server/services/storage-deletion-flags";

export interface StorageDeletionMetrics {
    generatedAt: string;
    flags: {
        lifecycleEnabled: boolean;
        workerEnabled: boolean;
    };
    backlog: {
        requests: number;
        oldestAgeSeconds: number | null;
        retries: number;
        blockedRequests: number;
        quarantinedRequests: number;
    };
    providerCleanup: {
        pendingItems: number;
        completedItems: number;
        blockedItems: number;
    };
    sqlPurge: {
        completedRequests: number;
        pendingRequests: number;
    };
    estimatedOrphanBytes: {
        bytes: number;
        source: "quarantined_manifest_rows";
    };
}

function safeBytes(value: bigint | null): number {
    if (value === null) return 0;
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : Number.MAX_SAFE_INTEGER;
}

export async function getStorageDeletionMetrics(
    companyId: number
): Promise<StorageDeletionMetrics> {
    const requests = await db
        .select({
            id: storageDeletionRequests.id,
            status: storageDeletionRequests.status,
            createdAt: storageDeletionRequests.createdAt,
            completedAt: storageDeletionRequests.completedAt,
        })
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.companyId, BigInt(companyId)));

    const requestIds = requests.map(request => BigInt(request.id));
    const items =
        requestIds.length === 0
            ? []
            : await db
                  .select({
                      itemState: storageDeletionItems.itemState,
                      attempts: storageDeletionItems.attempts,
                  })
                  .from(storageDeletionItems)
                  .where(inArray(storageDeletionItems.requestId, requestIds));

    const manifestRows = await db
        .select({
            lifecycleState: storageObjects.lifecycleState,
            sizeBytes: storageObjects.sizeBytes,
        })
        .from(storageObjects)
        .where(eq(storageObjects.companyId, BigInt(companyId)));

    const activeRequests = requests.filter(request => request.status !== "completed");
    const oldestCreatedAt = activeRequests.reduce<Date | null>(
        (oldest, request) => (!oldest || request.createdAt < oldest ? request.createdAt : oldest),
        null
    );
    const oldestAgeSeconds = oldestCreatedAt
        ? Math.max(0, Math.floor((Date.now() - oldestCreatedAt.getTime()) / 1000))
        : null;

    const pendingItems = items.filter(item =>
        ["PENDING", "IN_FLIGHT", "WAITING_RETRY", "RETRYABLE_FAILED", "LINKED"].includes(
            item.itemState
        )
    ).length;
    const completedItems = items.filter(item =>
        ["DELETED", "NOT_FOUND"].includes(item.itemState)
    ).length;
    const blockedItems = items.filter(item =>
        ["BLOCKED", "QUARANTINED"].includes(item.itemState)
    ).length;

    return {
        generatedAt: new Date().toISOString(),
        flags: getStorageDeletionFlagState(),
        backlog: {
            requests: activeRequests.length,
            oldestAgeSeconds,
            retries: items.filter(item => item.attempts > 0).length,
            blockedRequests: requests.filter(request => request.status === "manual_review").length,
            quarantinedRequests: requests.filter(request => request.status === "quarantined")
                .length,
        },
        providerCleanup: {
            pendingItems,
            completedItems,
            blockedItems,
        },
        sqlPurge: {
            completedRequests: requests.filter(request => request.completedAt !== null).length,
            pendingRequests: activeRequests.length,
        },
        estimatedOrphanBytes: {
            // Unmanifested provider orphans are only knowable from a successful
            // provider inventory scan. Quarantined manifest rows are the safe
            // database-side estimate exposed until that scan is imported.
            bytes: manifestRows
                .filter(row => row.lifecycleState === "QUARANTINED")
                .reduce((total, row) => total + safeBytes(row.sizeBytes), 0),
            source: "quarantined_manifest_rows",
        },
    };
}
