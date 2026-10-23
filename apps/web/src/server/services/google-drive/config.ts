/**
 * Configuration surface for Drive-linked files.
 *
 * The feature is dark by default: `isDriveLinkingEnabled()` gates every route
 * and the reconciler, and requires both the explicit flag and a configured
 * OAuth client — a half-configured deployment reads as "off", never as a
 * runtime error in the middle of a link.
 */
import { configureGoogleEndpoints, type GoogleOAuthApp } from "@launchstack/google-drive";

import { devRoutesEnabled } from "~/app/dev/enabled";
import { env } from "~/env";

export const GOOGLE_DRIVE_PROVIDER = "google-drive";

/** CSRF nonce cookie for the Google OAuth round trip (set by /oauth/start). */
export const GOOGLE_OAUTH_STATE_COOKIE = "gdrive_oauth_state";

/** Files this app created or the user picked for it — nothing else. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Read (never write) everything the account can see. The only way to import
 * a folder: under drive.file, picking a folder grants the folder itself and
 * none of what is inside it, so its listing comes back empty.
 */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Any of these lets a sync list a folder's contents. */
const FOLDER_READING_SCOPES = [DRIVE_READONLY_SCOPE, "https://www.googleapis.com/auth/drive"];

/**
 * drive.readonly is a Google *restricted* scope: the consent screen must list
 * it and, unless the app is Internal to one Google Workspace, Google must
 * verify the app before anyone outside its test users can grant it. The flag
 * is the operator saying that is done; off, a folder can't be imported.
 */
export function isDriveFolderAccessEnabled(): boolean {
    const raw = env.server.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED;
    return raw === "true" || raw === "1";
}

/**
 * drive.file always (Drive-linked files write through it); openid+email
 * identify which Google account holds the files. drive.readonly only when
 * someone asks for folder access and the operator allows it — never on a
 * plain connect, so connecting stays clear of Google's "unverified app"
 * warning that a restricted scope brings until the app is verified.
 */
export function googleDriveScopes(options: { folderAccess?: boolean } = {}): string[] {
    const folders = Boolean(options.folderAccess) && isDriveFolderAccessEnabled();
    return [DRIVE_FILE_SCOPE, ...(folders ? [DRIVE_READONLY_SCOPE] : []), "openid", "email"];
}

/** Whether a stored grant (space-separated, as Google returns it) can read folders. */
export function grantsFolderAccess(scopes: string | null | undefined): boolean {
    const granted = (scopes ?? "").split(/\s+/);
    return FOLDER_READING_SCOPES.some(scope => granted.includes(scope));
}

/**
 * Development only: the Google stand-in `next dev` serves under
 * /dev/stand-ins/google. Honoured only where the /dev routes are, so a
 * production build can never send a refresh token anywhere but Google.
 */
export function googleStandInUrl(): string | null {
    const raw = env.server.GOOGLE_STAND_IN_URL;
    if (!raw || !devRoutesEnabled()) return null;
    return raw.replace(/\/$/, "");
}

let endpointsApplied = false;

/**
 * Point @launchstack/google-drive at the stand-in, once, on first use. Lazy
 * because env is read per call elsewhere too (tests swap it); every path that
 * talks to Google goes through getGoogleOAuthApp() first, which calls this.
 */
function applyStandInEndpoints(): void {
    if (endpointsApplied) return;
    endpointsApplied = true;
    const standIn = googleStandInUrl();
    if (!standIn) return;
    configureGoogleEndpoints({
        authorizeUrl: `${standIn}/o/oauth2/v2/auth`,
        tokenUrl: `${standIn}/token`,
        driveApiBase: `${standIn}/drive/v3`,
        driveUploadBase: `${standIn}/upload/drive/v3`,
    });
}

/** Base URL for the knowledge-sync Drive client (pipelines' createDriveClient). */
export function driveApiBaseUrl(): string | undefined {
    const standIn = googleStandInUrl();
    return standIn ? `${standIn}/drive/v3` : undefined;
}

/** Folder the linked copies live in, lazily created in the owner's My Drive. */
export const DRIVE_FOLDER_NAME = "LaunchStack";

/** Same cap the adeu service enforces (MAX_FETCH_BYTES). */
export const MAX_LINKED_FILE_BYTES = 50 * 1024 * 1024;

const DEFAULT_SETTLE_MINUTES = 10;

export class GoogleDriveConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GoogleDriveConfigError";
    }
}

function flagEnabled(): boolean {
    const raw = env.server.GOOGLE_DOCS_EDITING_ENABLED;
    return raw === "true" || raw === "1";
}

export function isDriveLinkingEnabled(): boolean {
    return Boolean(flagEnabled() && isGoogleConnectConfigured());
}

/**
 * The connect flow gates on the OAuth pair alone: a connection now also powers
 * the Drive knowledge sync (picked files → knowledge base), which works
 * without GOOGLE_DOCS_EDITING_ENABLED. The Drive-links routes and reconciler
 * keep the stricter isDriveLinkingEnabled() gate.
 */
export function isGoogleConnectConfigured(): boolean {
    return Boolean(env.server.GOOGLE_OAUTH_CLIENT_ID && env.server.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function getGoogleOAuthApp(): GoogleOAuthApp {
    applyStandInEndpoints();
    const clientId = env.server.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = env.server.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new GoogleDriveConfigError(
            "Google Drive linking is not configured. Set GOOGLE_OAUTH_CLIENT_ID and " +
                "GOOGLE_OAUTH_CLIENT_SECRET (and GOOGLE_DOCS_EDITING_ENABLED=true)."
        );
    }
    return { clientId, clientSecret };
}

/**
 * The redirect URL must byte-match what is registered on the GCP OAuth
 * client, so an explicit env override wins; otherwise it is built on the
 * public origin the caller passes, `publicOrigin(request)` (BETTER_AUTH_URL).
 */
export function getOAuthRedirectUrl(origin: string): string {
    if (env.server.GOOGLE_OAUTH_REDIRECT_URL) return env.server.GOOGLE_OAUTH_REDIRECT_URL;
    return `${origin.replace(/\/$/, "")}/api/connectors/google/oauth/callback`;
}

export function getSettleWindowMs(): number {
    const raw = Number(env.server.GOOGLE_DOCS_SETTLE_MINUTES);
    const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SETTLE_MINUTES;
    return minutes * 60_000;
}
