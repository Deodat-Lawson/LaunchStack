/**
 * Authorization for internal `/api/files/{id}` references at upload ingress.
 *
 * `documentUrl` arrives from the client on every upload path. When it points
 * at an internal file row, the pipeline later hands that URL to the OCR
 * worker with a signed token attached — a token that bypasses the file
 * route's session check by design. So the workspace has to be proven to own
 * the row *before* a document or job exists, and the check cannot rely on
 * the caller-declared `storageType`: claiming `"s3"` used to be enough to
 * keep a foreign internal path intact all the way to the signer.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { fileUploads } from "@launchstack/store/schema";
import { isInternalFileUrl, parseInternalFileId as parseFileId } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import type { OCRProvider } from "@launchstack/conversion/ocr/types";

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
 * Returns the file id for an internal reference the company owns, or null
 * when the URL is external. Throws `UploadAuthorizationError` when the row
 * belongs to another tenant, has no tenant stamp, or does not exist — all
 * reported identically so the caller cannot probe for file ids.
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
        return null;
    }

    const fileId = parseFileId(url);
    if (fileId === null) return null;

    const [file] = await db
        .select({ companyId: fileUploads.companyId })
        .from(fileUploads)
        .where(eq(fileUploads.id, fileId));

    if (file?.companyId == null || file.companyId !== companyId) {
        throw new UploadAuthorizationError("File not found in this workspace", 404);
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
            "FILE_ACCESS_TOKEN_SECRET is not configured; database-backed documents cannot be read by the ingestion pipeline.",
            503
        );
    }

    return fileId;
}
