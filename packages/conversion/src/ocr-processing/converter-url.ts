/**
 * The URL handed to services/document-converter for a document it must fetch.
 *
 * The converter runs outside this process and has no session, so an internal
 * /api/files/{id} reference is rebuilt on APP_PUBLIC_URL's origin and signed
 * with a short-lived capability token. Mint it on the way into each request,
 * never reuse it across retries. External URLs pass through unsigned.
 */
import {
    FILE_ACCESS_TOKEN_PARAM,
    buildInternalFileUrl,
    isInternalFileUrl,
    parseInternalFileId,
    signFileAccessToken,
} from "@launchstack/store/crypto";

import { getOcrConfig } from "./config";

export function toConverterReachableUrl(url: string): string {
    const cfg = getOcrConfig();
    // One origin for all three steps. Resolving `isInternalFileUrl` against
    // the raw (possibly undefined) config while the rebuild uses the fallback
    // made every absolute same-origin URL look foreign whenever
    // APP_PUBLIC_URL was unset, so nothing got signed and the converter 401'd.
    const origin = cfg.appPublicUrl ?? "http://app:3000";
    const fileId = parseInternalFileId(url);
    const isInternal = isInternalFileUrl(url, origin);
    const absolute = new URL(url, origin);
    if (fileId === null || !isInternal) return absolute.toString();

    const canonical = new URL(buildInternalFileUrl(origin, fileId));

    const token = signFileAccessToken(String(fileId), cfg.fileAccessTokenSecret);
    if (token) {
        canonical.searchParams.set(FILE_ACCESS_TOKEN_PARAM, token);
    } else {
        console.warn(
            "[document-converter] FILE_ACCESS_TOKEN_SECRET is not configured; the document converter cannot read database-backed documents."
        );
    }

    return canonical.toString();
}
