/**
 * Configuration surface for Drive-linked files.
 *
 * The feature is dark by default: `isDriveLinkingEnabled()` gates every route
 * and the reconciler, and requires both the explicit flag and a configured
 * OAuth client — a half-configured deployment reads as "off", never as a
 * runtime error in the middle of a link.
 */
import type { GoogleOAuthApp } from "@launchstack/google-drive";

import { env } from "~/env";

export const GOOGLE_DRIVE_PROVIDER = "google-drive";

/**
 * drive.file only: the app can touch files it created, nothing else in the
 * user's Drive. openid+email identify which Google account holds the files.
 */
export const GOOGLE_DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "openid",
    "email",
];

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
    return Boolean(
        flagEnabled() && env.server.GOOGLE_OAUTH_CLIENT_ID && env.server.GOOGLE_OAUTH_CLIENT_SECRET
    );
}

export function getGoogleOAuthApp(): GoogleOAuthApp {
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
 * client, so an explicit env override wins; otherwise it is derived from
 * APP_PUBLIC_URL, with the request origin as the dev fallback.
 */
export function getOAuthRedirectUrl(requestOrigin: string): string {
    if (env.server.GOOGLE_OAUTH_REDIRECT_URL) return env.server.GOOGLE_OAUTH_REDIRECT_URL;
    const base = env.server.APP_PUBLIC_URL ?? requestOrigin;
    return `${base.replace(/\/$/, "")}/api/connectors/google/oauth/callback`;
}

export function getSettleWindowMs(): number {
    const raw = Number(env.server.GOOGLE_DOCS_SETTLE_MINUTES);
    const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SETTLE_MINUTES;
    return minutes * 60_000;
}
