import { and, asc, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { BackfillContext, BackfillResult } from "@launchstack/store/backfills";
import type { DbClient } from "@launchstack/store/client";
import { fileUploads } from "@launchstack/store/schema";

import { storageObjects } from "~/server/db/schema/storage";
import type { StoredObjectSource } from "~/server/storage/ledger";
import { currentStorageLocationId } from "~/server/storage/location";
import type { ObjectRef } from "~/server/storage/object-ref";
import { refFromStoredUrl } from "~/server/storage/stored-url";

function pendingPointers(cursor: BackfillContext["cursor"]) {
    const id = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? cursor.id : 0;
    return and(
        gt(fileUploads.id, Number(id)),
        isNotNull(fileUploads.companyId),
        inArray(fileUploads.storageProvider, ["s3", "database"])
    );
}

/** Estimate pointer rows to inspect, including S3 URLs that may be skipped by the parser. */
export async function countStorageLedgerPointers(
    db: DbClient,
    cursor: BackfillContext["cursor"]
): Promise<number> {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fileUploads)
        .where(pendingPointers(cursor));
    return row?.count ?? 0;
}

/** Replay is safe: a batch inserts once by frozen object identity, never overwriting ownership. */
export async function backfillStorageLedgerFromFileUploads({
    db,
    cursor,
    batchSize,
}: BackfillContext): Promise<BackfillResult> {
    const rows = await db
        .select({
            id: fileUploads.id,
            companyId: fileUploads.companyId,
            storageProvider: fileUploads.storageProvider,
            storageUrl: fileUploads.storageUrl,
            mimeType: fileUploads.mimeType,
            fileSize: fileUploads.fileSize,
            blobChecksum: fileUploads.blobChecksum,
        })
        .from(fileUploads)
        .where(pendingPointers(cursor))
        .orderBy(asc(fileUploads.id))
        .limit(batchSize);
    const source: StoredObjectSource = "backfill-file-uploads";
    const objects: (typeof storageObjects.$inferInsert)[] = [];
    for (const row of rows) {
        let ref: ObjectRef;
        let url: string;
        if (row.storageProvider === "database") {
            ref = {
                adapter: "database",
                storageLocationId: currentStorageLocationId("database")!,
                key: String(row.id),
            };
            url = `/api/files/${row.id}`;
        } else {
            if (!row.storageUrl) continue;
            const parsed = refFromStoredUrl(row.storageUrl);
            if (
                !parsed.ok ||
                parsed.ref.adapter !== "s3" ||
                parsed.ref.storageLocationId !== currentStorageLocationId("s3")
            )
                continue;
            ref = parsed.ref;
            url = row.storageUrl;
        }
        objects.push({
            adapter: ref.adapter,
            storageLocationId: ref.storageLocationId,
            objectKey: ref.key,
            url,
            companyId: row.companyId,
            source,
            contentType: row.mimeType,
            sizeBytes: row.fileSize,
            checksum: row.blobChecksum,
        });
    }
    if (objects.length > 0) {
        await db
            .insert(storageObjects)
            .values(objects)
            .onConflictDoNothing({
                target: [
                    storageObjects.adapter,
                    storageObjects.storageLocationId,
                    storageObjects.objectKey,
                ],
            });
    }
    const last = rows.at(-1);
    return { cursor: last ? { id: last.id } : null, processed: rows.length };
}
