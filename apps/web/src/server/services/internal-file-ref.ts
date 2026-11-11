/**
 * Authorization for stored-object references at upload ingress.
 *
 * Client URLs must prove workspace ownership before becoming document/job
 * references: internal files grant signed reads, and provider references may
 * later authorize byte deletion. Never trust the caller-declared storageType.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { fileUploads } from "@launchstack/store/schema";
import { isInternalFileUrl, parseInternalFileId as parseFileId } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import type { OCRProvider } from "@launchstack/conversion/ocr/types";
import { findStoredObjectsByRefs } from "~/server/storage/ledger";
import { refFromStoredUrl } from "~/server/storage/stored-url";
import { currentStorageLocationId } from "~/server/storage/location";

export { parseInternalFileId } from "@launchstack/store/crypto";

/** Fallback origin when APP_PUBLIC_URL is unset — the in-cluster app service. */
const DEFAULT_APP_ORIGIN = "http://app:3000";

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
    _effectiveProvider?: OCRProvider
): Promise<number | null> {
    const cfg = getOcrConfig();
    // Same fallback the URL builders use. Comparing against a bare undefined
    // `appPublicUrl` made every absolute same-origin reference look external,
    // so an unset APP_PUBLIC_URL silently skipped the whole ownership check.
    if (!isInternalFileUrl(url, cfg.appPublicUrl ?? DEFAULT_APP_ORIGIN)) {
        const parsed = refFromStoredUrl(url);
        if (
            parsed.ok &&
            parsed.ref.adapter !== "database" &&
            parsed.ref.storageLocationId === currentStorageLocationId(parsed.ref.adapter)
        ) {
            const [object] = await findStoredObjectsByRefs(db, [parsed.ref]);
            if (
                object?.companyId == null ||
                object.companyId !== companyId ||
                object.deletedAt != null ||
                object.url !== url
            ) {
                throw new UploadAuthorizationError(
                    { key: "upload.server.errors.fileNotInWorkspace" },
                    404
                );
            }
        }
        return null;
    }

    const fileId = parseFileId(url);
    if (fileId === null) return null;

    const [file] = await db
        .select({ companyId: fileUploads.companyId })
        .from(fileUploads)
        .where(eq(fileUploads.id, fileId));

    if (file?.companyId == null || file.companyId !== companyId) {
        throw new UploadAuthorizationError({ key: "upload.server.errors.fileNotInWorkspace" }, 404);
    }

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
