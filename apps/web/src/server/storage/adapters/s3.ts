import { currentStorageLocationId } from "../location";
import type { DeleteResult, ObjectRef } from "../object-ref";
import { deleteObjects as deleteS3Objects } from "../s3-client";

const AUTH_ERROR =
    /AccessDenied|Unauthorized|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|ExpiredToken|NoSuchBucket|Credentials|AuthFailure|^40[13]$/i;

export async function deleteObjects(refs: readonly ObjectRef[]): Promise<DeleteResult[]> {
    const location = currentStorageLocationId("s3");
    const results: DeleteResult[] = refs.map(ref => ({
        ref,
        outcome: "blocked",
        errorCode: location ? "storage_location_mismatch" : "storage_unconfigured",
    }));
    const indexes = refs.flatMap((ref, index) =>
        location && ref.storageLocationId === location ? [index] : []
    );
    for (let start = 0; start < indexes.length; start += 1000) {
        const chunk = indexes.slice(start, start + 1000);
        try {
            const response = await deleteS3Objects(chunk.map(index => refs[index]!.key));
            const errors = new Map(response.Errors?.map(error => [error.Key, error]));
            for (const index of chunk) {
                const ref = refs[index]!;
                const error = errors.get(ref.key);
                // S3 succeeds for missing objects too; not_found is unobservable.
                results[index] = error
                    ? {
                          ref,
                          outcome: AUTH_ERROR.test(error.Code ?? "") ? "blocked" : "retryable",
                          errorCode: error.Code,
                          message: error.Message,
                      }
                    : { ref, outcome: "deleted" };
            }
        } catch (error) {
            const details = error as {
                name?: string;
                Code?: string;
                code?: string;
                $metadata?: { httpStatusCode?: number };
            } | null;
            const errorCode = details?.Code ?? details?.code ?? details?.name ?? "s3_delete_failed";
            const message = error instanceof Error ? error.message : String(error);
            const blocked =
                details?.$metadata?.httpStatusCode === 403 ||
                AUTH_ERROR.test(`${errorCode} ${message}`);
            for (const index of chunk) {
                results[index] = {
                    ref: refs[index]!,
                    outcome: blocked ? "blocked" : "retryable",
                    errorCode,
                    message,
                };
            }
        }
    }
    return results;
}
