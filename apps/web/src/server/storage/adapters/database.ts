import { inArray } from "drizzle-orm";
import type { Executor } from "~/server/workspace/db-types";

import { currentStorageLocationId } from "../location";
import type { DeleteResult, ObjectRef } from "../object-ref";

export async function deleteObjects(
    refs: readonly ObjectRef[],
    executor?: Executor
): Promise<DeleteResult[]> {
    const location = currentStorageLocationId("database");
    const results: DeleteResult[] = refs.map(ref => ({
        ref,
        outcome: "blocked",
        errorCode: location ? "storage_location_mismatch" : "storage_unconfigured",
    }));
    const ids: number[] = [];
    const indexes: number[] = [];
    refs.forEach((ref, index) => {
        if (!location || ref.storageLocationId !== location) return;
        const id = Number(ref.key);
        if (!/^\d+$/.test(ref.key) || !Number.isSafeInteger(id)) {
            results[index] = { ref, outcome: "blocked", errorCode: "invalid_key" };
            return;
        }
        ids.push(id);
        indexes.push(index);
    });
    if (indexes.length === 0) return results;
    try {
        // See lib/storage: importing ~/server/db re-enters an initialization
        // cycle. The hoisted getEngine function safely supplies the same db.
        const { getEngine } = await import("~/server/engine");
        const { fileUploads } = await import("@launchstack/store/schema");
        const rows = await (executor ?? getEngine().db)
            .delete(fileUploads)
            .where(inArray(fileUploads.id, ids))
            .returning({ id: fileUploads.id });
        const deleted = new Set(rows.map(row => row.id));
        indexes.forEach((index, position) => {
            results[index] = {
                ref: refs[index]!,
                outcome: deleted.has(ids[position]!) ? "deleted" : "not_found",
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const index of indexes)
            results[index] = {
                ref: refs[index]!,
                outcome: "retryable",
                errorCode: "database_delete_failed",
                message,
            };
    }
    return results;
}
