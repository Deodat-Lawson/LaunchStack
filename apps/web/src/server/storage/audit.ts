import { randomUUID } from "node:crypto";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { and, asc, eq, gt, inArray, isNull, lt, notExists } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import { fileUploads } from "@launchstack/store/schema";

import { env } from "~/env";
import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
    type StoredObject,
} from "~/server/db/schema/storage";
import type { Executor, Tx } from "~/server/workspace/db-types";
import { planObjectDeletion } from "./deletion/plan";
import { findStoredObjectsByRefs, storedObjectRef } from "./ledger";
import { currentStorageLocationId } from "./location";
import { refIdentity, type ObjectRef } from "./object-ref";
import { findReferencedStorageObjects } from "./deletion/references";
import { getObjectUrl, getS3BucketName, getS3Client } from "./s3-client";

export interface OrphanAuditOptions {
    graceDays?: number;
    inventory?: boolean;
    enqueue?: boolean;
    actor?: string;
    pageSize?: number;
    sampleLimit?: number;
    now?: Date;
}

export interface OrphanAuditTotals {
    count: number;
    /** Known bytes only; unknownSizeCount makes missing sizes explicit. */
    bytes: number;
    unknownSizeCount: number;
}

export interface OrphanAuditPopulation extends OrphanAuditTotals {
    groups: (OrphanAuditTotals &
        Pick<ObjectRef, "adapter" | "storageLocationId"> & { source: string | null })[];
    sampleKeys: ObjectRef[];
}

type ScanStatus = { status: "scanned" } | { status: "not_scanned"; reason: string };

export interface OrphanAuditReport {
    generatedAt: string;
    graceDays: number;
    cutoff: string;
    ledger: OrphanAuditPopulation & {
        requestIds: number[];
        notEnqueueable: { count: number; reason: string };
    };
    inventory: OrphanAuditPopulation & {
        enabled: boolean;
        database: ScanStatus;
        s3: ScanStatus;
    };
}

/** Carries committed planner ids even if a later page/provider scan fails. */
export class StorageOrphanAuditError extends Error {
    constructor(
        cause: unknown,
        readonly report: OrphanAuditReport
    ) {
        super(cause instanceof Error ? cause.message : String(cause), { cause });
        this.name = "StorageOrphanAuditError";
    }
}

interface InventoryObject {
    id: string;
    ref: ObjectRef;
    urls: readonly string[];
    sizeBytes: number | null;
}

function population(): OrphanAuditPopulation {
    return { count: 0, bytes: 0, unknownSizeCount: 0, groups: [], sampleKeys: [] };
}

function addCandidate(
    report: OrphanAuditPopulation,
    ref: ObjectRef,
    sizeBytes: number | null,
    sampleLimit: number,
    source: string | null = null
) {
    let group = report.groups.find(
        entry =>
            entry.adapter === ref.adapter &&
            entry.storageLocationId === ref.storageLocationId &&
            entry.source === source
    );
    if (!group) {
        group = {
            adapter: ref.adapter,
            storageLocationId: ref.storageLocationId,
            source,
            count: 0,
            bytes: 0,
            unknownSizeCount: 0,
        };
        report.groups.push(group);
    }
    for (const total of [report, group]) {
        total.count++;
        if (sizeBytes === null) total.unknownSizeCount++;
        else total.bytes += sizeBytes;
    }
    if (report.sampleKeys.length < sampleLimit) report.sampleKeys.push(ref);
}

/** Match active requests by all persisted identities, including URL-only quarantined items. */
function hasNoActivePlan(tx: Executor) {
    const identities = [
        eq(storageDeletionItems.storedObjectId, storageObjects.id),
        and(
            eq(storageDeletionItems.adapter, storageObjects.adapter),
            eq(storageDeletionItems.storageLocationId, storageObjects.storageLocationId),
            eq(storageDeletionItems.objectKey, storageObjects.objectKey)
        ),
        eq(storageDeletionItems.sourceUrl, storageObjects.url),
    ];
    // Separate anti-joins let each identity use its own index (no cross-column OR).
    return and(
        ...identities.map(identity =>
            notExists(
                tx
                    .select({ id: storageDeletionItems.id })
                    .from(storageDeletionItems)
                    .innerJoin(
                        storageDeletionRequests,
                        eq(storageDeletionItems.requestId, storageDeletionRequests.id)
                    )
                    .where(
                        and(
                            identity,
                            inArray(storageDeletionRequests.status, ["pending", "blocked"])
                        )
                    )
            )
        )
    );
}

async function unreferencedLedger(tx: Executor, rows: readonly StoredObject[]) {
    const referenced = await findReferencedStorageObjects(
        tx,
        rows.map(row => ({
            id: String(row.id),
            urls: [row.url],
            ref: storedObjectRef(row),
            ledgered: true,
        }))
    );
    return rows.filter(row => !referenced.has(String(row.id)));
}

async function enqueuePage(tx: Tx, ids: bigint[], cutoff: Date, actor: string) {
    // Lock in key order, then recheck in a fresh statement: a competing audit may
    // have created a plan while this transaction waited for the ledger locks.
    await tx
        .select({ id: storageObjects.id })
        .from(storageObjects)
        .where(inArray(storageObjects.id, ids))
        .orderBy(asc(storageObjects.id))
        .for("update");
    const current = await tx
        .select()
        .from(storageObjects)
        .where(
            and(
                inArray(storageObjects.id, ids),
                isNull(storageObjects.deletedAt),
                lt(storageObjects.createdAt, cutoff),
                hasNoActivePlan(tx)
            )
        )
        .orderBy(asc(storageObjects.id));
    const candidates = await unreferencedLedger(tx, current);
    const companies = new Map<bigint, string[]>();
    for (const row of candidates) {
        if (row.companyId === null) continue;
        const urls = companies.get(row.companyId) ?? [];
        urls.push(row.url);
        companies.set(row.companyId, urls);
    }
    const requestIds: number[] = [];
    for (const [companyId, urls] of companies) {
        const requestId = await planObjectDeletion(tx, {
            companyId,
            urls,
            requestedBy: actor,
            reason: "orphan_audit",
            traceId: randomUUID(),
        });
        if (requestId !== null) requestIds.push(requestId);
    }
    return { candidates, requestIds };
}

async function auditInventoryPage(
    db: Executor,
    candidates: InventoryObject[],
    report: OrphanAuditPopulation,
    sampleLimit: number
) {
    if (!candidates.length) return;
    // One bounded anti-ledger lookup for the whole provider page, not per object.
    const ledger = await findStoredObjectsByRefs(
        db,
        candidates.map(candidate => candidate.ref)
    );
    const recorded = new Set(ledger.map(row => refIdentity(storedObjectRef(row))));
    const unrecorded = candidates.filter(candidate => !recorded.has(refIdentity(candidate.ref)));
    const referenced = await findReferencedStorageObjects(db, unrecorded);
    for (const candidate of unrecorded) {
        if (!referenced.has(candidate.id))
            addCandidate(report, candidate.ref, candidate.sizeBytes, sampleLimit);
    }
}

/** Read-only by default. Enqueue uses only population A and never calls a provider delete. */
export async function auditStorageOrphans(
    db: DbClient,
    options: OrphanAuditOptions = {}
): Promise<OrphanAuditReport> {
    const graceDays = options.graceDays ?? 7;
    const pageSize = options.pageSize ?? 500;
    const sampleLimit = options.sampleLimit ?? 20;
    if (!Number.isInteger(graceDays) || graceDays < 0)
        throw new Error("graceDays must be a non-negative integer");
    if (options.enqueue && graceDays < 1)
        throw new Error("enqueue requires graceDays of at least 1 day");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
        throw new Error("pageSize must be an integer from 1 to 1000");
    if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 1000)
        throw new Error("sampleLimit must be an integer from 0 to 1000");
    const actor = options.actor?.trim();
    if (options.enqueue && (!actor || actor.length > 256))
        throw new Error("--enqueue requires an actor of 1 to 256 characters");
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
    const report: OrphanAuditReport = {
        generatedAt: now.toISOString(),
        graceDays,
        cutoff: cutoff.toISOString(),
        ledger: {
            ...population(),
            requestIds: [],
            notEnqueueable: { count: 0, reason: "company_id is null; no tenant can be inferred" },
        },
        inventory: {
            ...population(),
            enabled: options.inventory ?? false,
            database: { status: "not_scanned", reason: "Inventory was not requested" },
            s3: { status: "not_scanned", reason: "Inventory was not requested" },
        },
    };
    try {
        let cursor = 0n;
        while (true) {
            const page = await db
                .select()
                .from(storageObjects)
                .where(
                    and(
                        gt(storageObjects.id, cursor),
                        isNull(storageObjects.deletedAt),
                        lt(storageObjects.createdAt, cutoff),
                        hasNoActivePlan(db)
                    )
                )
                .orderBy(asc(storageObjects.id))
                .limit(pageSize);
            if (!page.length) break;
            cursor = page[page.length - 1]!.id;
            let candidates: StoredObject[];
            if (options.enqueue) {
                const result = await db.transaction(tx =>
                    enqueuePage(
                        tx,
                        page.map(row => row.id),
                        cutoff,
                        actor!
                    )
                );
                candidates = result.candidates;
                report.ledger.requestIds.push(...result.requestIds);
            } else {
                candidates = await unreferencedLedger(db, page);
            }
            for (const row of candidates) {
                addCandidate(
                    report.ledger,
                    storedObjectRef(row),
                    row.sizeBytes,
                    sampleLimit,
                    row.source
                );
                if (row.companyId === null) report.ledger.notEnqueueable.count++;
            }
        }
        if (!options.inventory) return report;

        const databaseLocation = currentStorageLocationId("database")!;
        let fileCursor = 0;
        while (true) {
            const page = await db
                .select({ id: fileUploads.id, size: fileUploads.fileSize })
                .from(fileUploads)
                .where(
                    and(
                        gt(fileUploads.id, fileCursor),
                        lt(fileUploads.createdAt, cutoff),
                        eq(fileUploads.storageProvider, "database")
                    )
                )
                .orderBy(asc(fileUploads.id))
                .limit(pageSize);
            if (!page.length) break;
            fileCursor = page[page.length - 1]!.id;
            await auditInventoryPage(
                db,
                page.map(row => ({
                    id: String(row.id),
                    ref: {
                        adapter: "database",
                        storageLocationId: databaseLocation,
                        key: String(row.id),
                    },
                    urls: [`/api/files/${row.id}`],
                    sizeBytes: row.size,
                })),
                report.inventory,
                sampleLimit
            );
        }
        report.inventory.database = { status: "scanned" };

        const s3Location = currentStorageLocationId("s3");
        if (!s3Location || !env.server.S3_ACCESS_KEY || !env.server.S3_SECRET_KEY) {
            report.inventory.s3 = {
                status: "not_scanned",
                reason: "S3 location or credentials are not configured",
            };
            return report;
        }
        const client = getS3Client();
        let continuationToken: string | undefined;
        do {
            const page = await client.send(
                new ListObjectsV2Command({
                    Bucket: getS3BucketName(),
                    Prefix: "documents/",
                    MaxKeys: pageSize,
                    ContinuationToken: continuationToken,
                })
            );
            const candidates: InventoryObject[] = [];
            for (const object of page.Contents ?? []) {
                if (!object.Key || (object.LastModified && object.LastModified >= cutoff)) continue;
                candidates.push({
                    id: object.Key,
                    ref: { adapter: "s3", storageLocationId: s3Location, key: object.Key },
                    urls: [getObjectUrl(object.Key)],
                    sizeBytes: object.Size ?? null,
                });
            }
            await auditInventoryPage(db, candidates, report.inventory, sampleLimit);
            if (
                page.IsTruncated &&
                (!page.NextContinuationToken || page.NextContinuationToken === continuationToken)
            ) {
                throw new Error(
                    "S3 inventory returned a truncated page without an advancing continuation token"
                );
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        report.inventory.s3 = { status: "scanned" };
        return report;
    } catch (cause) {
        throw new StorageOrphanAuditError(cause, report);
    }
}
