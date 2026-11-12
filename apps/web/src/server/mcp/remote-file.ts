/**
 * Downloads a file ChatGPT hands to a tool. ChatGPT passes a file the person
 * attached as `{ download_url, file_id, mime_type, file_name }` in the
 * argument the tool names in `_meta["openai/fileParams"]`; the URL is
 * temporary (how long is not documented), so it is fetched at once.
 *
 * The URL comes from the request body, so it is untrusted: HTTPS only on
 * every hop, through the SSRF guard on every redirect hop, with a size cap
 * and a timeout.
 */
import { UrlGuardError, fetchPublicUrl } from "~/server/security/url-guard";

import { MAX_STAGED_BYTES, StagingError, readBodyWithLimit } from "./staging";

export const REMOTE_FILE_TIMEOUT_MS = 60_000;

export class RemoteFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RemoteFileError";
    }
}

export interface RemoteFile {
    data: Buffer;
    contentType: string | null;
}

export async function downloadAssistantFile(
    rawUrl: string,
    maxBytes = MAX_STAGED_BYTES
): Promise<RemoteFile> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new RemoteFileError("The file's download_url is not a valid URL.");
    }
    if (url.protocol !== "https:") {
        throw new RemoteFileError("The file's download_url must be an https:// link.");
    }
    let response: Response;
    try {
        // https on every hop: a redirect must not downgrade the download.
        response = await fetchPublicUrl(
            url.href,
            { signal: AbortSignal.timeout(REMOTE_FILE_TIMEOUT_MS) },
            { httpsOnly: true }
        );
    } catch (error) {
        if (error instanceof UrlGuardError) {
            throw new RemoteFileError(
                "The file's download_url points somewhere LaunchStack will not fetch from."
            );
        }
        throw new RemoteFileError(
            "LaunchStack could not download the file. Its link may have expired; attach it again."
        );
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteFileError(
            `LaunchStack could not download the file (HTTP ${response.status}). Its link may have expired; attach it again.`
        );
    }
    const declared = Number(response.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteFileError(`The file is larger than ${maxBytes / (1024 * 1024)} MB.`);
    }
    try {
        const data = await readBodyWithLimit(response.body, maxBytes);
        return { data, contentType: response.headers.get("content-type") };
    } catch (error) {
        if (error instanceof StagingError) throw new RemoteFileError(error.message);
        throw new RemoteFileError("LaunchStack could not download the file. Attach it again.");
    }
}
