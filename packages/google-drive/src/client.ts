/**
 * Google Drive v3 + OAuth 2.0 fetch client for Drive-linked documents.
 *
 * Deliberately not the googleapis SDK: the sync pipeline uses seven endpoints,
 * and every other service boundary in this repo is a thin typed fetch wrapper
 * (packages/editing is the model). Credentials are injected per call — this
 * package never reads process.env (ADR-002); the host owns token storage,
 * refresh scheduling, and retry policy.
 */
import {
    DRIVE_METADATA_FIELDS,
    GOOGLE_FOLDER_MIME,
    driveErrorSchema,
    driveFileListSchema,
    driveFileMetadataSchema,
    oauthErrorSchema,
    tokenResponseSchema,
    type DriveFileMetadata,
    type TokenResponse,
} from "./wire";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface GoogleOAuthApp {
    clientId: string;
    clientSecret: string;
}

export class GoogleDriveError extends Error {
    public readonly status: number;
    public readonly detail: string;

    constructor(status: number, detail: string) {
        super(`Google Drive error (${status}): ${detail}`);
        this.name = "GoogleDriveError";
        this.status = status;
        this.detail = detail;
    }

    get isNotFound(): boolean {
        return this.status === 404;
    }

    /** 429 and 5xx are worth retrying on the next reconciler tick; 4xx are not. */
    get isRetryable(): boolean {
        return this.status === 429 || this.status >= 500 || this.status === 0;
    }
}

export class GoogleAuthError extends GoogleDriveError {
    /** True when the user revoked the grant — reconnect is the only fix. */
    public readonly invalidGrant: boolean;

    constructor(status: number, detail: string, invalidGrant: boolean) {
        super(status, detail);
        this.name = "GoogleAuthError";
        this.invalidGrant = invalidGrant;
    }
}

async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        throw new GoogleDriveError(0, err instanceof Error ? err.message : String(err));
    } finally {
        clearTimeout(timeoutId);
    }
}

async function throwDriveError(res: Response): Promise<never> {
    let detail = `HTTP ${res.status}`;
    try {
        const body: unknown = await res.json();
        const parsed = driveErrorSchema.safeParse(body);
        if (parsed.success && parsed.data.error.message) {
            detail = parsed.data.error.message;
        }
    } catch {
        // Non-JSON error body; the status code is all we have.
    }
    if (res.status === 401) {
        throw new GoogleAuthError(res.status, detail, false);
    }
    throw new GoogleDriveError(res.status, detail);
}

async function requestToken(form: Record<string, string>): Promise<TokenResponse> {
    const res = await fetchWithTimeout(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
    });

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        let invalidGrant = false;
        try {
            const body: unknown = await res.json();
            const parsed = oauthErrorSchema.safeParse(body);
            if (parsed.success) {
                invalidGrant = parsed.data.error === "invalid_grant";
                detail = parsed.data.error_description
                    ? `${parsed.data.error}: ${parsed.data.error_description}`
                    : parsed.data.error;
            }
        } catch {
            // Fall through with the status-only detail.
        }
        throw new GoogleAuthError(res.status, detail, invalidGrant);
    }

    return tokenResponseSchema.parse(await res.json());
}

/** Authorization-code exchange (Leg 0 callback). */
export async function exchangeAuthorizationCode(params: {
    app: GoogleOAuthApp;
    code: string;
    redirectUri: string;
}): Promise<TokenResponse> {
    return requestToken({
        grant_type: "authorization_code",
        code: params.code,
        client_id: params.app.clientId,
        client_secret: params.app.clientSecret,
        redirect_uri: params.redirectUri,
    });
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshAccessToken(params: {
    app: GoogleOAuthApp;
    refreshToken: string;
}): Promise<TokenResponse> {
    return requestToken({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
        client_id: params.app.clientId,
        client_secret: params.app.clientSecret,
    });
}

/**
 * Claims from the id_token issued alongside the code exchange. The token was
 * received directly from Google's token endpoint over TLS, so the signature is
 * not re-verified here — this is a convenience decode, not an authentication
 * step.
 */
export function decodeIdTokenClaims(idToken: string): { sub?: string; email?: string } {
    const segments = idToken.split(".");
    if (segments.length < 2 || !segments[1]) return {};
    try {
        const payload = Buffer.from(segments[1], "base64url").toString("utf8");
        const claims = JSON.parse(payload) as Record<string, unknown>;
        return {
            sub: typeof claims.sub === "string" ? claims.sub : undefined,
            email: typeof claims.email === "string" ? claims.email : undefined,
        };
    } catch {
        return {};
    }
}

function authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
}

export async function getFileMetadata(params: {
    accessToken: string;
    fileId: string;
}): Promise<DriveFileMetadata> {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?fields=${encodeURIComponent(DRIVE_METADATA_FIELDS)}&supportsAllDrives=true`;
    const res = await fetchWithTimeout(url, { headers: authHeaders(params.accessToken) });
    if (!res.ok) return throwDriveError(res);
    return driveFileMetadataSchema.parse(await res.json());
}

/** Download the file's bytes as stored (`alt=media`) — binary files only. */
export async function downloadFileContent(params: {
    accessToken: string;
    fileId: string;
}): Promise<Buffer> {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?alt=media&supportsAllDrives=true`;
    const res = await fetchWithTimeout(url, { headers: authHeaders(params.accessToken) });
    if (!res.ok) return throwDriveError(res);
    return Buffer.from(await res.arrayBuffer());
}

/** Export a native Google file (Doc/Sheet/Slides) into the given format. */
export async function exportFileContent(params: {
    accessToken: string;
    fileId: string;
    mimeType: string;
}): Promise<Buffer> {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}/export?mimeType=${encodeURIComponent(params.mimeType)}`;
    const res = await fetchWithTimeout(url, { headers: authHeaders(params.accessToken) });
    if (!res.ok) return throwDriveError(res);
    return Buffer.from(await res.arrayBuffer());
}

function buildMultipartBody(
    metadata: Record<string, unknown>,
    mimeType: string,
    data: Buffer,
    boundary: string
): Buffer {
    const head =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    return Buffer.concat([Buffer.from(head, "utf8"), data, Buffer.from(tail, "utf8")]);
}

/** Create a file with content in one request (multipart upload). */
export async function createFileMultipart(params: {
    accessToken: string;
    name: string;
    mimeType: string;
    data: Buffer;
    parents?: string[];
}): Promise<DriveFileMetadata> {
    const boundary = `launchstack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const metadata: Record<string, unknown> = {
        name: params.name,
        mimeType: params.mimeType,
        ...(params.parents?.length ? { parents: params.parents } : {}),
    };
    const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(DRIVE_METADATA_FIELDS)}&supportsAllDrives=true`;
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
            ...authHeaders(params.accessToken),
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(buildMultipartBody(metadata, params.mimeType, params.data, boundary)),
    });
    if (!res.ok) return throwDriveError(res);
    return driveFileMetadataSchema.parse(await res.json());
}

/** Replace an existing file's content in place — same fileId, new revision. */
export async function updateFileMedia(params: {
    accessToken: string;
    fileId: string;
    mimeType: string;
    data: Buffer;
}): Promise<DriveFileMetadata> {
    const url = `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(params.fileId)}?uploadType=media&fields=${encodeURIComponent(DRIVE_METADATA_FIELDS)}&supportsAllDrives=true`;
    const res = await fetchWithTimeout(url, {
        method: "PATCH",
        headers: {
            ...authHeaders(params.accessToken),
            "Content-Type": params.mimeType,
        },
        body: new Uint8Array(params.data),
    });
    if (!res.ok) return throwDriveError(res);
    return driveFileMetadataSchema.parse(await res.json());
}

/** Move a file to the Drive trash (recoverable by the user for ~30 days). */
export async function trashFile(params: { accessToken: string; fileId: string }): Promise<void> {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?supportsAllDrives=true`;
    const res = await fetchWithTimeout(url, {
        method: "PATCH",
        headers: { ...authHeaders(params.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) return throwDriveError(res);
    // Drain the body so undici can reuse the connection.
    await res.arrayBuffer().catch(() => undefined);
}

/**
 * Find (or lazily create) a folder by name in the connected account's My
 * Drive. With the drive.file scope this only ever sees folders this app
 * created — which is exactly the containment we want.
 */
export async function ensureFolder(params: { accessToken: string; name: string }): Promise<string> {
    const escaped = params.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `name = '${escaped}' and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`;
    const listUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,mimeType)")}&pageSize=1`;
    const listRes = await fetchWithTimeout(listUrl, { headers: authHeaders(params.accessToken) });
    if (!listRes.ok) return throwDriveError(listRes);
    const listed = driveFileListSchema.parse(await listRes.json());
    const existing = listed.files[0];
    if (existing) return existing.id;

    const createRes = await fetchWithTimeout(`${DRIVE_API_BASE}/files?fields=id`, {
        method: "POST",
        headers: { ...authHeaders(params.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ name: params.name, mimeType: GOOGLE_FOLDER_MIME }),
    });
    if (!createRes.ok) return throwDriveError(createRes);
    const created = driveFileMetadataSchema
        .pick({ id: true })
        .extend({ mimeType: driveFileMetadataSchema.shape.mimeType.optional() })
        .parse(await createRes.json());
    return created.id;
}

/** Build the consent-screen URL for the authorization-code flow. */
export function buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
}): string {
    const search = new URLSearchParams({
        client_id: params.clientId,
        redirect_uri: params.redirectUri,
        response_type: "code",
        scope: params.scopes.join(" "),
        access_type: "offline",
        prompt: "consent",
        state: params.state,
    });
    return `${OAUTH_AUTHORIZE_URL}?${search.toString()}`;
}
