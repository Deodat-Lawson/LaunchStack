/**
 * Configuration surface for the Microsoft 365 connectors.
 *
 * One Entra app registration serves two kinds of connection: the workspace's
 * OneDrive and SharePoint files (`microsoft-365`) and a member's own Outlook
 * mailbox (`outlook`). It is a different registration from the sign-in one
 * (AUTH_MICROSOFT_*), exactly as Google Drive's OAuth client is separate
 * from Google sign-in's: this one holds Graph permissions and stores a
 * refresh token; sign-in holds neither.
 */
import { devRoutesEnabled } from "~/app/dev/enabled";
import { env } from "~/env";
import type { Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

export const MICROSOFT_365_PROVIDER = "microsoft-365";
export const OUTLOOK_PROVIDER = "outlook";
export type MicrosoftProvider = typeof MICROSOFT_365_PROVIDER | typeof OUTLOOK_PROVIDER;

/** CSRF nonce cookies for the OAuth round trip (set by /oauth/start). */
export const MICROSOFT_365_OAUTH_STATE_COOKIE = "m365_oauth_state";
export const OUTLOOK_OAUTH_STATE_COOKIE = "outlook_oauth_state";

/** Marks the OAuth state of an Outlook round trip, so the shared callback can tell the flows apart. */
export const OUTLOOK_STATE_PREFIX = "outlook.";

/**
 * Identify the account, and keep working while nobody is signed in:
 * without offline_access Microsoft issues no refresh token and the
 * background sync would stop within the hour.
 */
const IDENTITY_SCOPES = ["offline_access", "openid", "email", "profile"] as const;

/** Read (never write) files the account can open in OneDrive and SharePoint. */
export const FILES_READ_SCOPE = "Files.Read.All";
export const SITES_READ_SCOPE = "Sites.Read.All";
/** Read (never send, change or delete) the account's own mail. */
export const MAIL_READ_SCOPE = "Mail.Read";

export const MICROSOFT_365_SCOPES: string[] = [
    FILES_READ_SCOPE,
    SITES_READ_SCOPE,
    ...IDENTITY_SCOPES,
];
export const OUTLOOK_SCOPES: string[] = [MAIL_READ_SCOPE, ...IDENTITY_SCOPES];

/**
 * Whether a stored or returned grant (space-separated) carries `scope`.
 * Microsoft answers with either the short name or the resource-qualified
 * one (`https://graph.microsoft.com/Mail.Read`), in any letter case.
 */
export function grantIncludes(scopes: string | null | undefined, scope: string): boolean {
    const wanted = scope.toLowerCase();
    return (scopes ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .some(granted => {
            const lower = granted.toLowerCase();
            return lower === wanted || lower.endsWith(`/${wanted}`);
        });
}

/**
 * Development only: the Microsoft stand-in `next dev` serves under
 * /dev/stand-ins/microsoft. Honoured only where the /dev routes are, so a
 * production build can never send a refresh token anywhere but Microsoft.
 */
export function microsoftStandInUrl(): string | null {
    const raw = env.server.MICROSOFT_STAND_IN_URL;
    if (!raw || !devRoutesEnabled()) return null;
    return raw.replace(/\/$/, "");
}

const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com";

/** `common` unless the operator pinned one tenant. */
export function microsoftTenant(): string {
    const tenant = env.server.MICROSOFT_OAUTH_TENANT_ID?.trim();
    if (!tenant) return "common";
    return tenant;
}

export interface MicrosoftEndpoints {
    readonly authorizeUrl: string;
    readonly tokenUrl: string;
}

export function microsoftEndpoints(): MicrosoftEndpoints {
    const base = `${microsoftStandInUrl() ?? MICROSOFT_AUTHORITY}/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0`;
    return { authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token` };
}

/** Base URL for the pipelines' Graph clients; undefined means real Microsoft Graph. */
export function graphApiBaseUrl(): string | undefined {
    const standIn = microsoftStandInUrl();
    return standIn ? `${standIn}/graph/v1.0` : undefined;
}

/** The sentence may be a `Copy`: `message` is its English, `copy` what the route words. */
export class MicrosoftConfigError extends Error {
    readonly copy: Copy | null;

    constructor(message: string | Copy) {
        super(typeof message === "string" ? message : englishCopy(message));
        this.name = "MicrosoftConfigError";
        this.copy = typeof message === "string" ? null : message;
    }
}

/** The OAuth pair alone; tokens also need EMBEDDING_SECRETS_KEY (see isConnectorConfigured). */
export function isMicrosoftConnectConfigured(): boolean {
    return Boolean(
        env.server.MICROSOFT_OAUTH_CLIENT_ID && env.server.MICROSOFT_OAUTH_CLIENT_SECRET
    );
}

/** Whether a file connection can be made and kept: the pair and somewhere safe for its token. */
export function isMicrosoft365ConnectorConfigured(): boolean {
    return Boolean(isMicrosoftConnectConfigured() && env.server.EMBEDDING_SECRETS_KEY);
}

/**
 * Mail is opt-in per deployment. Mail.Read reaches a whole mailbox, and many
 * tenants require an administrator to consent to it before members can; the
 * flag is the operator saying the registration carries it.
 */
export function isOutlookConnectorEnabled(): boolean {
    const raw = env.server.OUTLOOK_CONNECTOR_ENABLED;
    return raw === "true" || raw === "1";
}

export function isOutlookConnectorConfigured(): boolean {
    return Boolean(isOutlookConnectorEnabled() && isMicrosoft365ConnectorConfigured());
}

export interface MicrosoftOAuthApp {
    clientId: string;
    clientSecret: string;
}

export function getMicrosoftOAuthApp(): MicrosoftOAuthApp {
    const clientId = env.server.MICROSOFT_OAUTH_CLIENT_ID;
    const clientSecret = env.server.MICROSOFT_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new MicrosoftConfigError({ key: "sources.server.microsoft.notConfigured" });
    }
    return { clientId, clientSecret };
}

/**
 * The redirect URL must byte-match one registered on the Entra app. It is
 * built on the public origin the caller passes, `publicOrigin(request)`
 * (BETTER_AUTH_URL).
 */
export function getMicrosoftRedirectUrl(origin: string): string {
    return `${origin.replace(/\/$/, "")}/api/connectors/microsoft/oauth/callback`;
}
