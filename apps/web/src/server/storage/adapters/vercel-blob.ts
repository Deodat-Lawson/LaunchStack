import { del } from "@vercel/blob";

import { env } from "~/env";

import { currentStorageLocationId } from "../location";
import type { DeleteResult, ObjectRef } from "../object-ref";

export async function deleteObjects(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
    const location = currentStorageLocationId("vercel-blob");
    const results: DeleteResult[] = refs.map(ref => ({
        ref,
        outcome: "blocked",
        errorCode: location ? "storage_location_mismatch" : "storage_unconfigured",
    }));
    const indexes = refs.flatMap((ref, index) =>
        location && ref.storageLocationId === location ? [index] : []
    );
    // The SDK accepts an array without enforcing a cap. Bound request sizes
    // to 1000 pathnames, matching the provider batch size used here.
    for (let start = 0; start < indexes.length; start += 1000) {
        const chunk = indexes.slice(start, start + 1000);
        try {
            await del(
                chunk.map(index => refs[index]!.key),
                { token: env.server.BLOB_READ_WRITE_TOKEN }
            );
            // del returns void, including for an already absent blob.
            for (const index of chunk) results[index] = { ref: refs[index]!, outcome: "deleted" };
        } catch (error) {
            const details = error as {
                name?: string;
                code?: string;
                status?: number;
                statusCode?: number;
            } | null;
            const errorCode = details?.code ?? details?.name ?? "vercel_blob_delete_failed";
            const message = error instanceof Error ? error.message : String(error);
            const blocked =
                details?.status === 401 ||
                details?.status === 403 ||
                details?.statusCode === 401 ||
                details?.statusCode === 403 ||
                /access[ _-]?denied|Unauthorized|Forbidden|token|suspended|StoreNotFound|store[\s_-]*not[\s_-]*found|store.*does not exist/i.test(
                    `${errorCode} ${message}`
                );
            for (const index of chunk)
                results[index] = {
                    ref: refs[index]!,
                    outcome: blocked ? "blocked" : "retryable",
                    errorCode,
                    message,
                };
        }
    }
    return results;
}
