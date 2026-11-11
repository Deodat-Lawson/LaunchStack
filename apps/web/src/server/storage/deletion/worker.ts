import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import {
    document,
    documentVersions,
    fileUploads,
    ocrJobs,
    uploadBatchFiles,
} from "@launchstack/store/schema";

import { getEngine } from "~/server/engine";
import { brandChannels, brandMedia } from "~/server/db/schema/brand";
import { collabAgentPersona } from "~/server/db/schema/collab";
import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
} from "~/server/db/schema/storage";
import type { Executor } from "~/server/workspace/db-types";
import { deleteStoredObjects } from "../delete-objects";
import { findStoredObjectsByRefs } from "../ledger";
import { refIdentity, type DeleteResult, type ObjectRef } from "../object-ref";
import { refFromStoredUrl } from "../stored-url";

/** Inventory and detached job/batch history are not live references. Never tenant-filter this query. */
async function isReferenced(tx: Executor, urls: string[], ref: ObjectRef): Promise<boolean> {
    const matched = await tx.execute<{ referenced: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1 FROM ${document} WHERE ${inArray(document.url, urls)}
                OR ${inArray(sql`${document.ocrMetadata}->'websitePreview'->>'url'`, urls)}
                OR ${inArray(sql`${document.ocrMetadata}->>'audioUrl'`, urls)}
            UNION ALL
            SELECT 1 FROM ${documentVersions} WHERE ${inArray(documentVersions.url, urls)}
                OR ${inArray(sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`, urls)}
                OR ${inArray(sql`${documentVersions.ocrMetadata}->>'audioUrl'`, urls)}
            UNION ALL
            SELECT 1 FROM ${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id}
                WHERE ${inArray(ocrJobs.documentUrl, urls)}
            UNION ALL
            SELECT 1 FROM ${uploadBatchFiles} INNER JOIN ${document} ON ${uploadBatchFiles.documentId} = ${document.id}
                WHERE ${inArray(uploadBatchFiles.storageUrl, urls)}
            UNION ALL SELECT 1 FROM ${brandMedia} WHERE ${inArray(brandMedia.storageUrl, urls)}
            UNION ALL SELECT 1 FROM ${brandChannels} WHERE ${inArray(brandChannels.avatarUrl, urls)}
            UNION ALL SELECT 1 FROM ${collabAgentPersona} WHERE ${inArray(collabAgentPersona.avatarUrl, urls)}
        ) AS referenced`);
    if (matched[0]?.referenced === true) return true;
    // Only plausible aliases cross the database boundary; final parsing still
    // verifies the complete adapter/location/key identity, never a substring.
    const databasePattern = /^\d+$/.test(ref.key)
        ? `/api/files/0*${BigInt(ref.key).toString()}/?([?#]|$)`
        : null;
    const plausibleAlias = (column: SQLWrapper) =>
        ref.adapter === "database"
            ? databasePattern === null
                ? sql`false`
                : sql`${column} ~ ${databasePattern}`
            : sql`strpos(${column}, ${ref.key}) > 0`;
    const candidates = await tx.execute<{ url: string | null }>(sql`
        SELECT ${document.url} AS url FROM ${document} WHERE ${plausibleAlias(document.url)}
        UNION SELECT ${documentVersions.url} FROM ${documentVersions} WHERE ${plausibleAlias(documentVersions.url)}
        UNION SELECT ${document.ocrMetadata}->'websitePreview'->>'url' FROM ${document} WHERE ${plausibleAlias(sql`${document.ocrMetadata}->'websitePreview'->>'url'`)}
        UNION SELECT ${document.ocrMetadata}->>'audioUrl' FROM ${document} WHERE ${plausibleAlias(sql`${document.ocrMetadata}->>'audioUrl'`)}
        UNION SELECT ${documentVersions.ocrMetadata}->'websitePreview'->>'url' FROM ${documentVersions} WHERE ${plausibleAlias(sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`)}
        UNION SELECT ${documentVersions.ocrMetadata}->>'audioUrl' FROM ${documentVersions} WHERE ${plausibleAlias(sql`${documentVersions.ocrMetadata}->>'audioUrl'`)}
        UNION SELECT ${ocrJobs.documentUrl} FROM ${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id} WHERE ${plausibleAlias(ocrJobs.documentUrl)}
        UNION SELECT ${uploadBatchFiles.storageUrl} FROM ${uploadBatchFiles} INNER JOIN ${document} ON ${uploadBatchFiles.documentId} = ${document.id} WHERE ${plausibleAlias(uploadBatchFiles.storageUrl)}
        UNION SELECT ${brandMedia.storageUrl} FROM ${brandMedia} WHERE ${plausibleAlias(brandMedia.storageUrl)}
        UNION SELECT ${brandChannels.avatarUrl} FROM ${brandChannels} WHERE ${plausibleAlias(brandChannels.avatarUrl)}
        UNION SELECT ${collabAgentPersona.avatarUrl} FROM ${collabAgentPersona} WHERE ${plausibleAlias(collabAgentPersona.avatarUrl)}
    `);
    const identity = refIdentity(ref);
    return candidates.some(candidate => {
        if (typeof candidate.url !== "string") return false;
        const parsed = refFromStoredUrl(candidate.url);
        return parsed.ok && refIdentity(parsed.ref) === identity;
    });
}

async function saveOutcome(
    tx: Executor,
    id: number,
    attempts: number,
    result: DeleteResult
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
        .where(and(eq(storageDeletionItems.id, id), eq(storageDeletionItems.state, "pending")));
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
    const pending = await db
        .select({ id: storageDeletionItems.id })
        .from(storageDeletionItems)
        .where(
            and(
                eq(storageDeletionItems.requestId, requestId),
                eq(storageDeletionItems.state, "pending")
            )
        );
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
                return null;
            }
            const urls = [...new Set([item.sourceUrl, ...ledger.map(row => row.url)])];
            if (await isReferenced(tx, urls, ref)) {
                await tx
                    .update(storageDeletionItems)
                    .set({
                        state: "retained",
                        errorCode: null,
                        lastError: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(storageDeletionItems.id, id));
                return null;
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
                await saveOutcome(tx, id, item.attempts, result);
                return null;
            }
            return ref;
        });
        if (networkRef) {
            // Provider deletes are idempotent; no pooled connection or row lock
            // is held while waiting on S3, Blob, or UploadThing.
            const [result] = await deleteStoredObjects([networkRef]);
            if (!result) throw new Error("Storage adapter returned no deletion outcome");
            await db.transaction(async tx => {
                const [item] = await tx
                    .select()
                    .from(storageDeletionItems)
                    .where(eq(storageDeletionItems.id, id))
                    .for("update");
                if (item?.state === "pending") await saveOutcome(tx, id, item.attempts, result);
            });
        }
    }
    const states = await db.transaction(async tx => {
        const [current] = await tx
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, requestId))
            .for("update");
        if (!current) return [];
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
        await tx
            .update(storageDeletionRequests)
            .set({
                status,
                updatedAt: new Date(),
                completedAt: status === "completed" ? (current.completedAt ?? new Date()) : null,
            })
            .where(eq(storageDeletionRequests.id, requestId));
        return states;
    });
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
    await getEngine().db.transaction(async tx => {
        const [request] = await tx
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, requestId))
            .for("update");
        if (!request || request.status === "completed") return;
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
    });
}
