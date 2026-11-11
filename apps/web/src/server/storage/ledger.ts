import { and, eq, inArray, or } from "drizzle-orm";

import { storageObjects, type StoredObject } from "~/server/db/schema/storage";
import type { Executor as DbOrTx } from "~/server/workspace/db-types";

import { refIdentity, type ObjectRef } from "./object-ref";

export type StoredObjectSource =
    | "upload-file"
    | "vercel-blob"
    | "uploadthing"
    | "storage-upload-route";

export interface RecordStoredObjectInput {
    ref: ObjectRef;
    url: string;
    companyId: bigint | number | null;
    source: StoredObjectSource;
    contentType?: string | null;
    sizeBytes?: number | null;
    checksum?: string | null;
}

// Accept the caller's executor: importing the shared db would re-enter the
// server/db -> engine -> storage/port -> lib/storage initialization cycle.
export async function recordStoredObject(
    db: DbOrTx,
    input: RecordStoredObjectInput
): Promise<void> {
    await db
        .insert(storageObjects)
        .values({
            adapter: input.ref.adapter,
            storageLocationId: input.ref.storageLocationId,
            objectKey: input.ref.key,
            url: input.url,
            companyId: input.companyId === null ? null : BigInt(input.companyId),
            source: input.source,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            checksum: input.checksum,
        })
        .onConflictDoNothing({
            target: [
                storageObjects.adapter,
                storageObjects.storageLocationId,
                storageObjects.objectKey,
            ],
        });
}

export async function findStoredObjectsByUrls(
    db: DbOrTx,
    urls: readonly string[]
): Promise<StoredObject[]> {
    const unique = [...new Set(urls.filter(url => url.length > 0))];
    if (unique.length === 0) return [];
    return db.select().from(storageObjects).where(inArray(storageObjects.url, unique));
}

export async function findStoredObjectsByRefs(
    db: DbOrTx,
    refs: readonly ObjectRef[]
): Promise<StoredObject[]> {
    const unique = new Map(refs.map(ref => [refIdentity(ref), ref]));
    if (unique.size === 0) return [];
    return db
        .select()
        .from(storageObjects)
        .where(
            or(
                ...Array.from(unique.values(), ref =>
                    and(
                        eq(storageObjects.adapter, ref.adapter),
                        eq(storageObjects.storageLocationId, ref.storageLocationId),
                        eq(storageObjects.objectKey, ref.key)
                    )
                )
            )
        );
}

export function storedObjectRef(row: StoredObject): ObjectRef {
    return { adapter: row.adapter, storageLocationId: row.storageLocationId, key: row.objectKey };
}
