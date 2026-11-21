/**
 * Authorization for stored-object references at upload ingress.
 *
 * Client URLs must prove workspace ownership before becoming document/job
 * references: internal files grant signed reads, and provider references may
 * later authorize byte deletion. Never trust the caller-declared storageType.
 */

import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import type { OCRProvider } from "@launchstack/conversion/ocr/types";
import { authorizeStoredObjectUrl } from "~/server/storage/authorize-stored-object-url";
import type { Executor } from "~/server/workspace/db-types";

export { parseInternalFileId } from "@launchstack/store/crypto";

// Lives in its own module so routes can catch it without importing the db
// client transitively; re-exported here for existing callers.
import { UploadAuthorizationError } from "./upload-authorization-error";

export { UploadAuthorizationError };

/**
 * Authorize an upload's `documentUrl` against the active workspace.
 *
 * Returns the id of an owned internal file, or null for an owned provider
 * reference or external URL. Missing, unstamped and foreign stored objects
 * all produce the same error, so callers cannot probe for their existence.
 */
export async function authorizeInternalFileRef(
    url: string,
    companyId: bigint,
    /**
     * Accepted for call-site symmetry with the upload paths. The token
     * requirement no longer varies by provider — every out-of-session reader of
     * `/api/files/{id}` signs — so it does not affect the outcome.
     */
    _effectiveProvider?: OCRProvider,
    executor?: Executor
): Promise<number | null> {
    const { fileId } = await authorizeStoredObjectUrl(url, companyId, executor);
    if (fileId === null) return null;

    // Re-read after the ownership query: the real `db` proxy may call
    // getEngine() → configureOcr mid-flight. A cfg snapshot from the top of
    // this function would still be empty on a cold process and skip the check.
    const configured = getOcrConfig();

    // Every server-side reader of /api/files/{id} — the document converter, and
    // in-process paths (native PDF, page counting, VLM enrichment, archive
    // expansion) that go through `fetchFile` — signs a short-lived token,
    // because the route has no session to offer. Without a secret none of them
    // can read the file, so fail here rather than hand the client a 202 for a
    // job that can only end in a 401 at fetch time.
    if (!configured.fileAccessTokenSecret) {
        throw new UploadAuthorizationError(
            { key: "upload.server.errors.fileAccessSecretMissing" },
            503
        );
    }

    return fileId;
}
