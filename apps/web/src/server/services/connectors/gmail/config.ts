/**
 * Gmail connector configuration — the per-user Google provider.
 *
 * Dark by default. `gmail.readonly` is a Google *restricted* scope: the GCP
 * consent screen must list it and, unless the app is Internal to one Google
 * Workspace, Google must verify the app before anyone outside a test-user
 * list can grant it. GMAIL_CONNECTOR_ENABLED is the operator saying that has
 * been done; the OAuth client pair and the secret-box key are the same gates
 * every connector has.
 *
 * The OAuth client is the one Drive uses (GOOGLE_OAUTH_CLIENT_ID/SECRET) —
 * one Google app, two products — but a Gmail grant is always its own
 * connection row, so a Drive admin is never asked for mailbox access.
 */
import { env } from "~/env";
import { MAX_FOLDER_NAME_CHARS } from "~/lib/folders/path";

export const GMAIL_PROVIDER = "gmail" as const;

/** CSRF nonce cookie for the Gmail OAuth round trip (set by /oauth/start?provider=gmail). */
export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

/** The OAuth `state` carries this prefix so the shared callback can tell the flows apart. */
export const GMAIL_STATE_PREFIX = "gmail.";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** Read-only mail plus identity. Never send, modify or delete. */
export const GMAIL_SCOPES = [GMAIL_READONLY_SCOPE, "openid", "email"];

/** Every member's mailbox folder nests under this restricted root. */
export const GMAIL_ROOT_FOLDER = "Gmail";

function flagEnabled(raw: string | undefined): boolean {
    return raw === "true" || raw === "1";
}

export function isGmailConnectorEnabled(): boolean {
    return flagEnabled(env.server.GMAIL_CONNECTOR_ENABLED);
}

/**
 * The flag, the Google OAuth pair, and somewhere safe to keep a refresh
 * token. A half-configured deployment reads as "off", never as a runtime
 * error halfway through a connect.
 */
export function isGmailConnectorConfigured(): boolean {
    return Boolean(
        isGmailConnectorEnabled() &&
            env.server.GOOGLE_OAUTH_CLIENT_ID &&
            env.server.GOOGLE_OAUTH_CLIENT_SECRET &&
            env.server.EMBEDDING_SECRETS_KEY
    );
}

/**
 * `Gmail/<address>` — one folder per connected mailbox. The address is the
 * natural name (a person may connect different accounts in different
 * workspaces); it is trimmed to the folder-name limit and stripped of the
 * path separator so it always passes the folder rules.
 */
export function gmailFolderFor(accountEmail: string): string {
    const segment = accountEmail
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS);
    return `${GMAIL_ROOT_FOLDER}/${segment || "mailbox"}`;
}
