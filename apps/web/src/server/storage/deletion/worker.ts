import { and, eq, inArray, or, sql, type SQLWrapper } from "drizzle-orm";
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
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
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

/** Inventory and completed history are not live references. Never tenant-filter this query. */
async function isReferenced(
    tx: Executor,
    { urls, ref, ledgered }: { urls: string[]; ref: ObjectRef; ledgered: boolean }
): Promise<boolean> {
    const matched = await tx.execute<{ referenced: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1 FROM ${document} WHERE ${inArray(document.url, urls)}
            UNION ALL SELECT 1 FROM ${document}
                WHERE ${inArray(sql`${document.ocrMetadata}->'websitePreview'->>'url'`, urls)}
            UNION ALL SELECT 1 FROM ${document}
                WHERE ${inArray(sql`${document.ocrMetadata}->>'audioUrl'`, urls)}
            UNION ALL SELECT 1 FROM ${documentVersions} WHERE ${inArray(documentVersions.url, urls)}
            UNION ALL SELECT 1 FROM ${documentVersions}
                WHERE ${inArray(sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`, urls)}
            UNION ALL SELECT 1 FROM ${documentVersions}
                WHERE ${inArray(sql`${documentVersions.ocrMetadata}->>'audioUrl'`, urls)}
            UNION ALL
            SELECT 1 FROM ${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id}
                WHERE ${inArray(ocrJobs.documentUrl, urls)}
                    AND ${inArray(ocrJobs.status, ["queued", "processing"])}
            UNION ALL
            SELECT 1 FROM ${uploadBatchFiles}
                WHERE ${inArray(uploadBatchFiles.storageUrl, urls)}
                    AND ${inArray(uploadBatchFiles.status, ["queued", "uploaded", "processing", "failed"])}
            UNION ALL SELECT 1 FROM ${brandMedia} WHERE ${inArray(brandMedia.storageUrl, urls)}
            UNION ALL SELECT 1 FROM ${brandChannels} WHERE ${inArray(brandChannels.avatarUrl, urls)}
            UNION ALL SELECT 1 FROM ${collabAgentPersona} WHERE ${inArray(collabAgentPersona.avatarUrl, urls)}
            UNION ALL SELECT 1 FROM ${workspaceSessionMessages}
                WHERE ${or(...urls.map(url => sql`${workspaceSessionMessages.attachments} @> ${JSON.stringify([{ url }])}::jsonb`))}
            UNION ALL SELECT 1 FROM ${workspaceSessionMessages}
                WHERE ${or(...urls.map(url => sql`${workspaceSessionMessages.metadata} @> ${JSON.stringify({ send: { attachments: [{ url }] } })}::jsonb`))}
            UNION ALL SELECT 1 FROM ${workspaceSessions}
                WHERE ${or(...urls.map(url => sql`${workspaceSessions.queuedMessages} @> ${JSON.stringify([{ send: { attachments: [{ url }] } }])}::jsonb`))}
        ) AS referenced`);
    if (matched[0]?.referenced === true) return true;
    // Provider ingress requires the inventory URL. Database paths remain a
    // conservative guard on every origin, including historical audio metadata.
    if (ledgered && ref.adapter !== "database") return false;
    const databasePattern = /^\d+$/.test(ref.key)
        ? `/api/files/0*${BigInt(ref.key).toString()}([/?#]|$)`
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
        UNION SELECT ${ocrJobs.documentUrl} FROM ${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id}
            WHERE ${plausibleAlias(ocrJobs.documentUrl)} AND ${inArray(ocrJobs.status, ["queued", "processing"])}
        UNION SELECT ${uploadBatchFiles.storageUrl} FROM ${uploadBatchFiles}
            WHERE ${plausibleAlias(uploadBatchFiles.storageUrl)} AND ${inArray(uploadBatchFiles.status, ["queued", "uploaded", "processing", "failed"])}
        UNION SELECT ${brandMedia.storageUrl} FROM ${brandMedia} WHERE ${plausibleAlias(brandMedia.storageUrl)}
        UNION SELECT ${brandChannels.avatarUrl} FROM ${brandChannels} WHERE ${plausibleAlias(brandChannels.avatarUrl)}
        UNION SELECT ${collabAgentPersona.avatarUrl} FROM ${collabAgentPersona} WHERE ${plausibleAlias(collabAgentPersona.avatarUrl)}
        UNION SELECT attachment->>'url' FROM ${workspaceSessionMessages},
            LATERAL jsonb_array_elements(${workspaceSessionMessages.attachments}) AS attachment
            WHERE ${plausibleAlias(sql`attachment->>'url'`)}
        UNION SELECT attachment->>'url' FROM ${workspaceSessionMessages},
            LATERAL jsonb_array_elements(${workspaceSessionMessages.metadata}->'send'->'attachments') AS attachment
            WHERE ${plausibleAlias(sql`attachment->>'url'`)}
        UNION SELECT attachment->>'url' FROM ${workspaceSessions},
            LATERAL jsonb_array_elements(${workspaceSessions.queuedMessages}) AS queued,
            LATERAL jsonb_array_elements(queued->'send'->'attachments') AS attachment
            WHERE ${plausibleAlias(sql`attachment->>'url'`)}
    `);
    if (ref.adapter === "database") return candidates.length > 0;
    const identity = refIdentity(ref);
    return candidates.some(candidate => {
        if (typeof candidate.url !== "string") return false;
        const parsed = refFromStoredUrl(candidate.url);
        return parsed.ok && refIdentity(parsed.ref) === identity;
    });
}

/** A live /api/files pointer also protects the provider bytes it serves. */
async function hasReferencedPointer(
    tx: Executor,
    urls: string[],
    ref: ObjectRef
): Promise<boolean> {
    const pointers = await tx
        .select()
        .from(fileUploads)
        .where(
            and(
                sql`${fileUploads.storageProvider} <> 'database'`,
                or(
                    inArray(fileUploads.storageUrl, urls),
                    sql`strpos(${fileUploads.storageUrl}, ${ref.key}) > 0`
                )
            )
        );
    const identity = refIdentity(ref);
    const matching = pointers.filter(pointer => {
        if (!pointer.storageUrl) return false;
        if (urls.includes(pointer.storageUrl)) return true;
        const parsed = refFromStoredUrl(pointer.storageUrl);
        return parsed.ok && refIdentity(parsed.ref) === identity;
    });
    const pointerRefs = matching.map(pointer => ({
        adapter: "database" as const,
        storageLocationId: "database:file_uploads",
        key: String(pointer.id),
    }));
    const ledger = await findStoredObjectsByRefs(tx, pointerRefs);
    for (const pointerRef of pointerRefs) {
        const rows = ledger.filter(row => row.objectKey === pointerRef.key);
        if (
            await isReferenced(tx, {
                urls: rows.length ? rows.map(row => row.url) : [`/api/files/${pointerRef.key}`],
                ref: pointerRef,
                ledgered: rows.length > 0,
            })
        )
            return true;
    }
    return false;
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
        .select({ id: storageDeletionItems.id })
        .from(storageDeletionItems)
        .where(
            and(
                eq(storageDeletionItems.requestId, requestId),
                eq(storageDeletionItems.state, "pending")
            )
        )
        .orderBy(storageDeletionItems.id);
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
            const urls = ledger.length
                ? [...new Set(ledger.map(row => row.url))]
                : [item.sourceUrl];
            if (
                (await isReferenced(tx, { urls, ref, ledgered: ledger.length > 0 })) ||
                (ref.adapter !== "database" && (await hasReferencedPointer(tx, urls, ref)))
            ) {
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
                if (
                    item?.state === "pending" ||
                    (item?.state === "blocked" &&
                        item.errorCode === "retry_budget_exhausted" &&
                        (result.outcome === "deleted" || result.outcome === "not_found"))
                )
                    await saveOutcome(tx, id, item.attempts, result);
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
