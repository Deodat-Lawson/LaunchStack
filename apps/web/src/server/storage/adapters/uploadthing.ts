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
        response?: { status?: number };
    } | null;
    const errorCode = details?.code ?? details?.name ?? "uploadthing_delete_failed";
    const message = error instanceof Error ? error.message : String(error);
    const blocked =
        details?.status === 401 ||
        details?.status === 403 ||
        details?.statusCode === 401 ||
        details?.statusCode === 403 ||
        details?.response?.status === 401 ||
        details?.response?.status === 403 ||
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
    let api: UTApi;
    try {
        api = new UTApi({ token: env.server.UPLOADTHING_TOKEN });
    } catch (error) {
        for (const index of indexes) results[index] = failure(refs[index]!, error);
        return results;
    }
    for (let start = 0; start < indexes.length; start += 500) {
        const chunk = indexes.slice(start, start + 500);
        try {
            const response = await api.deleteFiles(chunk.map(index => refs[index]!.key));
            if (response.success && response.deletedCount === chunk.length) {
                for (const index of chunk)
                    results[index] = { ref: refs[index]!, outcome: "deleted" };
                continue;
            }
            if (!response.success || !(response.deletedCount < chunk.length)) {
                for (const index of chunk) {
                    results[index] = {
                        ref: refs[index]!,
                        outcome: "retryable",
                        errorCode: "uploadthing_delete_failed",
                    };
                }
                continue;
            }
        } catch (error) {
            // A thrown batch gives no per-key evidence; do not amplify failures.
            for (const index of chunk) results[index] = failure(refs[index]!, error);
            continue;
        }
        // Only successful partial batches justify individual probes. A zero
        // count cannot distinguish batch-deleted keys from never-existing keys.
        for (const index of chunk) {
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
    }
    return results;
}
