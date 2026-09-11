/**
 * Thin Drive v3 client over `fetch` — the eight endpoints the connector needs,
 * and nothing else. Deliberately not `googleapis`: that package is the
 * heaviest dependency it would add to this workspace, and its auth machinery
 * duplicates what the host already owns (tokens live in our database).
 *
 * Every request goes through one retry wrapper (rate limits, 5xx) and every
 * file/changes call carries the shared-drive flags, so files picked from a
 * shared drive just work.
 */
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
/**
 * Every listing carries the fields change detection needs, so a sync can
 * fingerprint an unchanged corpus without a single download.
 */
export const DRIVE_FILE_FIELDS = "id,name,mimeType,size,md5Checksum,headRevisionId,version,modifiedTime,trashed,parents,shortcutDetails";
/** The file is gone or the app lost its drive.file grant — re-pick territory. */
export class DriveAccessError extends Error {
    fileId;
    status;
    constructor(fileId, status) {
        super(`Drive file ${fileId} is inaccessible (HTTP ${status}) — deleted or grant lost`);
        this.fileId = fileId;
        this.status = status;
        this.name = "DriveAccessError";
    }
}
/** A Google-native file exceeded the Drive export size cap (~10 MB). */
export class DriveExportTooLargeError extends Error {
    fileId;
    constructor(fileId) {
        super(`Drive file ${fileId} exceeds the export size limit`);
        this.fileId = fileId;
        this.name = "DriveExportTooLargeError";
    }
}
export class DriveApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "DriveApiError";
    }
}
const RETRYABLE_403_REASONS = ["userRateLimitExceeded", "rateLimitExceeded"];
const ACCESS_403_REASONS = ["insufficientPermissions", "appNotAuthorizedToFile", "notFound"];
function errorReasons(body) {
    return body?.error?.errors?.map(entry => entry.reason ?? "").filter(Boolean) ?? [];
}
function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function createDriveClient(options) {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const maxAttempts = options.maxAttempts ?? 5;
    async function driveFetch(url, fileId) {
        let lastStatus = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetchImpl(url, {
                headers: { Authorization: `Bearer ${options.accessToken}` },
            });
            if (response.ok)
                return response;
            lastStatus = response.status;
            let body = null;
            try {
                body = (await response.clone().json());
            }
            catch {
                body = null;
            }
            const reasons = errorReasons(body);
            if (response.status === 403 && reasons.includes("exportSizeLimitExceeded")) {
                throw new DriveExportTooLargeError(fileId ?? "unknown");
            }
            if (response.status === 404 ||
                (response.status === 403 && reasons.some(r => ACCESS_403_REASONS.includes(r)))) {
                throw new DriveAccessError(fileId ?? "unknown", response.status);
            }
            const retryable = response.status === 429 ||
                response.status >= 500 ||
                (response.status === 403 && reasons.some(r => RETRYABLE_403_REASONS.includes(r)));
            if (!retryable || attempt === maxAttempts - 1) {
                throw new DriveApiError(body?.error?.message ?? `Drive API request failed (HTTP ${response.status})`, response.status);
            }
            const retryAfter = Number(response.headers.get("Retry-After"));
            const backoffMs = Number.isFinite(retryAfter)
                ? retryAfter * 1000
                : 1000 * 2 ** attempt + Math.random() * 500;
            await sleep(backoffMs);
        }
        throw new DriveApiError(`Drive API request failed (HTTP ${lastStatus})`, lastStatus);
    }
    async function json(url, fileId) {
        const response = await driveFetch(url, fileId);
        return (await response.json());
    }
    async function bytes(url, fileId) {
        const response = await driveFetch(url, fileId);
        return new Uint8Array(await response.arrayBuffer());
    }
    return {
        getFile(fileId) {
            const url = new URL(`${DRIVE_BASE}/files/${fileId}`);
            url.searchParams.set("fields", DRIVE_FILE_FIELDS);
            url.searchParams.set("supportsAllDrives", "true");
            return json(url.toString(), fileId);
        },
        listChildren(folderId, pageToken) {
            const url = new URL(`${DRIVE_BASE}/files`);
            url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
            url.searchParams.set("fields", `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
            url.searchParams.set("pageSize", "1000");
            url.searchParams.set("supportsAllDrives", "true");
            url.searchParams.set("includeItemsFromAllDrives", "true");
            if (pageToken)
                url.searchParams.set("pageToken", pageToken);
            return json(url.toString(), folderId);
        },
        async getStartPageToken() {
            const url = new URL(`${DRIVE_BASE}/changes/startPageToken`);
            url.searchParams.set("supportsAllDrives", "true");
            const payload = await json(url.toString());
            return payload.startPageToken;
        },
        listChanges(pageToken) {
            const url = new URL(`${DRIVE_BASE}/changes`);
            url.searchParams.set("pageToken", pageToken);
            url.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${DRIVE_FILE_FIELDS}))`);
            url.searchParams.set("pageSize", "1000");
            url.searchParams.set("supportsAllDrives", "true");
            url.searchParams.set("includeItemsFromAllDrives", "true");
            return json(url.toString());
        },
        download(fileId) {
            const url = new URL(`${DRIVE_BASE}/files/${fileId}`);
            url.searchParams.set("alt", "media");
            url.searchParams.set("supportsAllDrives", "true");
            return bytes(url.toString(), fileId);
        },
        exportFile(fileId, mimeType) {
            const url = new URL(`${DRIVE_BASE}/files/${fileId}/export`);
            url.searchParams.set("mimeType", mimeType);
            return bytes(url.toString(), fileId);
        },
    };
}
//# sourceMappingURL=client.js.map