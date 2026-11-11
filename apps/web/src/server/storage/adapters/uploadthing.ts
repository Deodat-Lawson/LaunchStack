import { UTApi } from "uploadthing/server";

import { env } from "~/env";

import { currentStorageLocationId } from "../location";
import type { DeleteResult, ObjectRef } from "../object-ref";

function failure(ref: ObjectRef, error: unknown): DeleteResult {
    const details = error as {
        code?: string;
        name?: string;
        status?: number;
        statusCode?: number;
    } | null;
    const errorCode = details?.code ?? details?.name ?? "uploadthing_delete_failed";
    const message = error instanceof Error ? error.message : String(error);
    const blocked =
        details?.status === 401 ||
        details?.status === 403 ||
        details?.statusCode === 401 ||
        details?.statusCode === 403 ||
        /Unauthorized|Forbidden|AccessDenied|INVALID_SERVER_CONFIG|MISSING_ENV|invalid.*(?:token|api.?key)|authentication|credentials/i.test(
            `${errorCode} ${message}`
        );
    return { ref, outcome: blocked ? "blocked" : "retryable", errorCode, message };
}

export async function deleteObjects(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
    const location = currentStorageLocationId("uploadthing");
    const results: DeleteResult[] = refs.map(ref => ({
        ref,
        outcome: "blocked",
        errorCode: location ? "storage_location_mismatch" : "storage_unconfigured",
    }));
    const indexes = refs.flatMap((ref, index) =>
        location && ref.storageLocationId === location ? [index] : []
    );
    if (indexes.length === 0) return results;
    let api: UTApi | undefined;
    try {
        api = new UTApi({ token: env.server.UPLOADTHING_TOKEN });
        const response = await api.deleteFiles(indexes.map(index => refs[index]!.key));
        if (response.success && response.deletedCount === indexes.length) {
            for (const index of indexes) results[index] = { ref: refs[index]!, outcome: "deleted" };
            return results;
        }
    } catch (error) {
        // A failed batch gives no per-key evidence. Auth failures are already
        // definitive; other failures use the same per-key fallback as partials.
        if (failure(refs[indexes[0]!]!, error).outcome === "blocked") {
            for (const index of indexes) results[index] = failure(refs[index]!, error);
            return results;
        }
        // UTApi construction can fail before a client is available.
        if (!api) {
            for (const index of indexes) results[index] = failure(refs[index]!, error);
            return results;
        }
    }
    for (const index of indexes) {
        const ref = refs[index]!;
        try {
            const response = await api.deleteFiles(ref.key);
            results[index] = response.success
                ? { ref, outcome: response.deletedCount === 0 ? "not_found" : "deleted" }
                : { ref, outcome: "retryable", errorCode: "uploadthing_delete_failed" };
        } catch (error) {
            results[index] = failure(ref, error);
        }
    }
    return results;
}
