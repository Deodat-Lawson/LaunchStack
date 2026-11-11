import { deleteStoredObjects } from "./delete-objects";
import type { ObjectRef } from "./object-ref";

/** Keep write-ahead inventory until provider deletion is positively acknowledged. */
export async function discardUnrecordedObject(ref: ObjectRef, context: string): Promise<boolean> {
    try {
        const results = await deleteStoredObjects([ref]);
        const result = results[0];
        if (
            results.length === 1 &&
            (result?.outcome === "deleted" || result?.outcome === "not_found")
        ) {
            return true;
        }
        console.warn("Failed to compensate storage write", { context, ref, results });
    } catch (error) {
        console.warn("Failed to compensate storage write", { context, ref, error });
    }
    return false;
}
