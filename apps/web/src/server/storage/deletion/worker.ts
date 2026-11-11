import { and, eq, inArray, or } from "drizzle-orm";
import { eventOutbox, fileUploads } from "@launchstack/store/schema";
import { eventIds } from "@launchstack/orchestration/pipeline-events";

import { getEngine } from "~/server/engine";
import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
} from "~/server/db/schema/storage";
import type { Executor } from "~/server/workspace/db-types";
import { deleteStoredObjects } from "../delete-objects";
import { findStoredObjectsByRefs, storedObjectRef } from "../ledger";
import { refIdentity, type DeleteResult, type ObjectRef } from "../object-ref";
import {
    findReferencedStorageObjects,
    findStorageObjectPointers,
    type StorageReferenceCandidate,
} from "./references";
import { recomputeDeletionRequestStatus } from "./status";
import {
    refreshStorageDeletionBacklog,
    storageDeletionItemsProcessed,
    storageDeletionRequestsFinished,
} from "~/server/metrics/storage-deletion";

async function saveOutcome(
    tx: Executor,
    id: number,
    attempts: number,
    result: DeleteResult,
    companyId: bigint,
    urls: readonly string[]
): Promise<void> {
    await tx
        .update(storageDeletionItems)
        .set({
            state: result.outcome === "retryable" ? "pending" : result.outcome,
            attempts: attempts + 1,
            errorCode: result.errorCode ?? null,
            lastError: result.message ?? null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(storageDeletionItems.id, id),
                result.outcome === "deleted" || result.outcome === "not_found"
                    ? or(
                          eq(storageDeletionItems.state, "pending"),
                          and(
                              eq(storageDeletionItems.state, "blocked"),
                              eq(storageDeletionItems.errorCode, "retry_budget_exhausted")
                          )
                      )
                    : eq(storageDeletionItems.state, "pending")
            )
        );
    if (result.outcome === "deleted" || result.outcome === "not_found") {
        await tx
            .update(storageObjects)
            .set({ deletedAt: new Date() })
            .where(
                and(
                    eq(storageObjects.adapter, result.ref.adapter),
                    eq(storageObjects.storageLocationId, result.ref.storageLocationId),
                    eq(storageObjects.objectKey, result.ref.key)
                )
            );
        if (result.ref.adapter === "s3" && urls.length) {
            await tx
                .delete(fileUploads)
                .where(
                    and(
                        eq(fileUploads.companyId, companyId),
                        inArray(fileUploads.storageUrl, [...urls])
                    )
                );
        }
    }
}

/** Outcomes commit before a retry is thrown: redelivery only retries remaining pending items. */
export async function processStorageDeletionRequest(requestId: number): Promise<void> {
    const db = getEngine().db;
    const [request] = await db
        .select()
        .from(storageDeletionRequests)
        .where(eq(storageDeletionRequests.id, requestId));
    if (!request || request.status === "completed") return;
    await db
        .update(storageDeletionItems)
        .set({ state: "pending", errorCode: null, lastError: null, updatedAt: new Date() })
        .where(
            and(
                eq(storageDeletionItems.requestId, requestId),
                eq(storageDeletionItems.state, "blocked"),
                eq(storageDeletionItems.errorCode, "retry_budget_exhausted")
            )
        );
    const pending = await db
        .select()
        .from(storageDeletionItems)
        .where(
            and(
                eq(storageDeletionItems.requestId, requestId),
                eq(storageDeletionItems.state, "pending")
            )
        )
        .orderBy(storageDeletionItems.id);
    const refs = pending.flatMap(item =>
        item.adapter && item.storageLocationId && item.objectKey
            ? [
                  {
                      adapter: item.adapter,
                      storageLocationId: item.storageLocationId,
                      key: item.objectKey,
                  },
              ]
            : []
    );
    const ledgerRows = await findStoredObjectsByRefs(db, refs);
    const ledgerByRef = new Map(ledgerRows.map(row => [refIdentity(storedObjectRef(row)), row]));
    const candidates = pending.flatMap<StorageReferenceCandidate>(item => {
        if (!item.adapter || !item.storageLocationId || !item.objectKey) return [];
        const ref: ObjectRef = {
            adapter: item.adapter,
            storageLocationId: item.storageLocationId,
            key: item.objectKey,
        };
        const ledger = ledgerByRef.get(refIdentity(ref));
        return [
            {
                id: String(item.id),
                ref,
                ledgered: ledger !== undefined && ledger.source !== "backfill-file-uploads",
                urls: ledger ? [ledger.url] : [item.sourceUrl],
            },
        ];
    });
    const pointers = await findStorageObjectPointers(db, candidates);
    const referenced = await findReferencedStorageObjects(db, candidates, pointers);
    for (const { id } of pending) {
        const networkRef = await db.transaction(async tx => {
            const [currentRequest] = await tx
                .select()
                .from(storageDeletionRequests)
                .where(eq(storageDeletionRequests.id, requestId))
                .for("update");
            if (!currentRequest || currentRequest.status === "completed") return null;
            const [item] = await tx
                .select()
                .from(storageDeletionItems)
                .where(eq(storageDeletionItems.id, id))
                .for("update");
            if (!item || item.state !== "pending") return null;
            if (!item.adapter || !item.storageLocationId || !item.objectKey)
                throw new Error(`Pending storage deletion item ${id} has no ref`);
            const ref: ObjectRef = {
                adapter: item.adapter,
                storageLocationId: item.storageLocationId,
                key: item.objectKey,
            };
            const ledger = await findStoredObjectsByRefs(tx, [ref]);
            const foreignLedger = ledger.some(
                row => row.companyId !== null && row.companyId !== currentRequest.companyId
            );
            let foreignFile = false;
            if (
                ref.adapter === "database" &&
                /^\d+$/.test(ref.key) &&
                Number.isSafeInteger(Number(ref.key))
            ) {
                const [file] = await tx
                    .select({ companyId: fileUploads.companyId })
                    .from(fileUploads)
                    .where(eq(fileUploads.id, Number(ref.key)));
                foreignFile = file !== undefined && file.companyId !== currentRequest.companyId;
            }
            const urls = [...new Set([item.sourceUrl, ...ledger.map(row => row.url)])];
            if (ref.adapter !== "database") {
                // Re-read exact pointer provenance on EVERY attempt. The initial
                // request-wide pointer lookup is only a reference-scan accelerator.
                const currentPointers = await tx
                    .select({ companyId: fileUploads.companyId })
                    .from(fileUploads)
                    .where(inArray(fileUploads.storageUrl, urls));
                foreignFile =
                    currentPointers.some(
                        pointer => pointer.companyId !== currentRequest.companyId
                    ) ||
                    pointers.some(
                        pointer =>
                            pointer.id === String(id) &&
                            (pointer.company_id === null ||
                                BigInt(pointer.company_id) !== currentRequest.companyId)
                    );
            }
            if (foreignLedger || foreignFile) {
                await tx
                    .update(storageDeletionItems)
                    .set({
                        state: "blocked",
                        errorCode: "foreign_object",
                        lastError: "Object provenance does not match the deletion request company",
                        updatedAt: new Date(),
                    })
                    .where(eq(storageDeletionItems.id, id));
                return { outcome: "blocked" as const };
            }
            const candidate: StorageReferenceCandidate = {
                id: String(id),
                ref,
                ledgered: ledger.length > 0 && ledger[0]!.source !== "backfill-file-uploads",
                urls: ledger.length ? ledger.map(row => row.url) : [item.sourceUrl],
            };
            // Expensive legacy scans stay request-wide. Refresh the indexed
            // arms under this item's lock, including live uses of new pointers.
            const currentPointers = await findStorageObjectPointers(tx, [candidate], true);
            const liveReferences = referenced.has(String(id))
                ? referenced
                : await findReferencedStorageObjects(
                      tx,
                      [candidate],
                      [
                          ...currentPointers,
                          ...pointers.filter(pointer => pointer.id === String(id)),
                      ],
                      true
                  );
            if (liveReferences.has(String(id))) {
                await tx
                    .update(storageDeletionItems)
                    .set({
                        state: "retained",
                        errorCode: null,
                        lastError: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(storageDeletionItems.id, id));
                return { outcome: "retained" as const };
            }
            if (ref.adapter === "database") {
                // postgres.js tracks caught statement failures within a scope.
                // A supported nested transaction isolates that failed scope and
                // rolls its savepoint back before the outer tx stores the retry.
                let result: DeleteResult | undefined;
                try {
                    await tx.transaction(async providerTx => {
                        [result] = await deleteStoredObjects([ref], providerTx);
                        if (!result)
                            throw new Error("Storage adapter returned no deletion outcome");
                    });
                } catch (error) {
                    if (result?.outcome !== "retryable") throw error;
                }
                if (!result) throw new Error("Storage adapter returned no deletion outcome");
                await saveOutcome(tx, id, item.attempts, result, currentRequest.companyId, urls);
                return { outcome: result.outcome };
            }
            return { ref, urls };
        });
        if (networkRef && "outcome" in networkRef) {
            storageDeletionItemsProcessed.inc({ outcome: networkRef.outcome });
        } else if (networkRef && "ref" in networkRef) {
            // Provider deletes are idempotent; no pooled connection or row lock
            // is held while waiting on S3, Blob, or UploadThing.
            const [result] = await deleteStoredObjects([networkRef.ref]);
            if (!result) throw new Error("Storage adapter returned no deletion outcome");
            const persisted = await db.transaction(async tx => {
                const [item] = await tx
                    .select()
                    .from(storageDeletionItems)
                    .where(eq(storageDeletionItems.id, id))
                    .for("update");
                if (
                    item?.state === "pending" ||
                    (item?.state === "blocked" &&
                        item.errorCode === "retry_budget_exhausted" &&
                        (result.outcome === "deleted" || result.outcome === "not_found"))
                ) {
                    await saveOutcome(
                        tx,
                        id,
                        item.attempts,
                        result,
                        request.companyId,
                        networkRef.urls
                    );
                    return true;
                }
                return false;
            });
            if (persisted) storageDeletionItemsProcessed.inc({ outcome: result.outcome });
        }
    }
    const { states, status, previousStatus } = await db.transaction(tx =>
        recomputeDeletionRequestStatus(tx, requestId)
    );
    if (status !== previousStatus && status !== "pending")
        storageDeletionRequestsFinished.inc({ status });
    await refreshStorageDeletionBacklog(db);
    const counts = states.reduce<Record<string, number>>((counts, state) => {
        counts[state] = (counts[state] ?? 0) + 1;
        return counts;
    }, {});
    console.info("[storage-deletion] processed", { traceId: request.traceId, requestId, counts });
    if (states.includes("pending"))
        throw new Error(`Storage deletion request ${requestId} has retryable pending items`);
}

export async function markStorageDeletionRequestDead(
    requestId: number,
    traceId?: string
): Promise<void> {
    const db = getEngine().db;
    const result = await db.transaction(async tx => {
        const [request] = await tx
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, requestId))
            .for("update");
        if (!request || request.status === "completed") return;
        const [delivery] = await tx
            .select({ status: eventOutbox.status })
            .from(eventOutbox)
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(requestId)))
            .for("update");
        // A delayed callback must not undo an operator's committed replay.
        if (delivery?.status !== "dead") return;
        const items = await tx
            .update(storageDeletionItems)
            .set({
                state: "blocked",
                errorCode: "retry_budget_exhausted",
                lastError:
                    "Storage deletion outbox event exhausted its retry budget or failed validation",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(storageDeletionItems.requestId, requestId),
                    eq(storageDeletionItems.state, "pending")
                )
            )
            .returning({ id: storageDeletionItems.id });
        await tx
            .update(storageDeletionRequests)
            .set({ status: "blocked", updatedAt: new Date(), completedAt: null })
            .where(eq(storageDeletionRequests.id, requestId));
        console.error("[storage-deletion] dead", {
            traceId: traceId ?? request.traceId,
            requestId,
            counts: { blocked: items.length },
        });
        return { previousStatus: request.status, blocked: items.length };
    });
    if (result) {
        storageDeletionItemsProcessed.inc({ outcome: "blocked" }, result.blocked);
        if (result.previousStatus !== "blocked")
            storageDeletionRequestsFinished.inc({ status: "blocked" });
    }
    await refreshStorageDeletionBacklog(db);
}
