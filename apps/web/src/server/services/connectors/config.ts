/**
 * Workspace-connection configuration, derived from env in one place.
 *
 * Google Drive connects through its own flow (`/api/connectors/google/oauth/*`
 * and `~/server/services/google-drive/*` — the OAuth client pair is
 * GOOGLE_OAUTH_CLIENT_ID/SECRET); this module owns the generic layer that
 * serves Slack, GitHub, LinkedIn and Notion, plus the cross-provider status
 * map the UI reads.
 *
 * "Configured" requires the provider's OAuth client pair AND the secret-box
 * key — without EMBEDDING_SECRETS_KEY there is nowhere safe to put a token,
 * so a provider declines to exist rather than store one in plaintext.
 */

import { env } from "~/env";
import type { ConnectorProvider } from "~/server/db/schema/connectors";
import { configuredPublicOrigin } from "~/server/public-origin";
import { googleStandInUrl } from "../google-drive/config";
import { isGmailConnectorEnabled } from "./gmail/config";
import * as github from "./providers/github";
import * as linkedin from "./providers/linkedin";
import * as notion from "./providers/notion";
import * as slack from "./providers/slack";
import type { ProviderGrant, ProviderOAuthConfig, RefreshedProviderToken } from "./providers/types";

/** The providers whose OAuth handshake this generic layer performs. */
export const OAUTH_PROVIDERS = ["slack", "github", "linkedin", "notion"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string): value is OAuthProvider {
    return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export function connectorCallbackPath(provider: OAuthProvider): string {
    return `/api/connectors/${provider}/oauth/callback`;
}

interface ProviderModule {
    buildAuthUrl(config: ProviderOAuthConfig, state: string): string;
    exchangeCode(config: ProviderOAuthConfig, code: string): Promise<ProviderGrant>;
    refreshAccessToken(
        config: ProviderOAuthConfig,
        refreshToken: string
    ): Promise<RefreshedProviderToken>;
    revokeToken(config: ProviderOAuthConfig, token: string): Promise<boolean>;
}

export const PROVIDER_MODULES: Record<OAuthProvider, ProviderModule> = {
    slack: slack,
    github: github,
    linkedin: linkedin,
    notion: notion,
};

function clientPair(provider: OAuthProvider): { clientId: string; clientSecret: string } | null {
    const pairs: Record<OAuthProvider, [string | undefined, string | undefined]> = {
        slack: [env.server.SLACK_CLIENT_ID, env.server.SLACK_CLIENT_SECRET],
        github: [env.server.GITHUB_OAUTH_CLIENT_ID, env.server.GITHUB_OAUTH_CLIENT_SECRET],
        linkedin: [env.server.LINKEDIN_CLIENT_ID, env.server.LINKEDIN_CLIENT_SECRET],
        notion: [env.server.NOTION_OAUTH_CLIENT_ID, env.server.NOTION_OAUTH_CLIENT_SECRET],
    };
    const [clientId, clientSecret] = pairs[provider];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isConnectorConfigured(provider: ConnectorProvider): boolean {
    if (!env.server.EMBEDDING_SECRETS_KEY) return false;
    // Google's pair lives with the Drive services; reported here so the UI
    // has one status map across providers.
    if (provider === "google-drive") {
        return Boolean(env.server.GOOGLE_OAUTH_CLIENT_ID && env.server.GOOGLE_OAUTH_CLIENT_SECRET);
    }
    // Gmail shares the Google pair but is opt-in: its scope is restricted at
    // Google and the operator must have prepared the consent screen for it.
    if (provider === "gmail") {
        return Boolean(
            isGmailConnectorEnabled() &&
                env.server.GOOGLE_OAUTH_CLIENT_ID &&
                env.server.GOOGLE_OAUTH_CLIENT_SECRET
        );
    }
    // Bluesky has no OAuth app to register: a workspace pastes an app
    // password, which only needs somewhere safe to be stored.
    if (provider === "bluesky") return true;
    return Boolean(clientPair(provider));
}

/**
 * @param origin The public origin of the current request, `publicOrigin(request)`.
 * Without one (a refresh in the worker) BETTER_AUTH_URL's origin is used.
 */
export function getConnectorConfig(
    provider: OAuthProvider,
    origin?: string
): ProviderOAuthConfig | null {
    const pair = clientPair(provider);
    if (!pair || !env.server.EMBEDDING_SECRETS_KEY) return null;

    const base = origin ?? configuredPublicOrigin();

    return {
        ...pair,
        // Without a request (a refresh in the worker) there is nothing to
        // redirect to, and refresh and revoke send no redirect URI.
        redirectUri: base ? new URL(connectorCallbackPath(provider), base).toString() : "",
        ...(provider === "linkedin" ? linkedInOverrides() : {}),
    };
}

/**
 * The deployment's LinkedIn app decides the scopes (see providers/linkedin);
 * the two base URLs exist so a dev stand-in can answer for LinkedIn.
 */
function linkedInOverrides(): Pick<ProviderOAuthConfig, "authBaseUrl" | "apiBaseUrl" | "scopes"> {
    const scopes = (env.server.LINKEDIN_OAUTH_SCOPES ?? "")
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
    return {
        authBaseUrl: env.server.LINKEDIN_OAUTH_BASE_URL,
        apiBaseUrl: env.server.LINKEDIN_API_BASE_URL,
        scopes: scopes.length > 0 ? scopes : linkedin.LINKEDIN_DEFAULT_SCOPES,
    };
}

/** The scopes this deployment asks LinkedIn for. */
export function linkedInRequestedScopes(): readonly string[] {
    return linkedInOverrides().scopes ?? linkedin.LINKEDIN_DEFAULT_SCOPES;
}

export const GOOGLE_PICKER_SCRIPT = "https://apis.google.com/js/api.js";

export interface PickerPublicConfig {
    readonly apiKey: string | null;
    readonly appId: string | null;
    /** Where the Picker's script loads from: Google, or the dev stand-in's copy. */
    readonly scriptUrl: string;
}

/** Browser-side Google Picker config; every value is public by design. */
export function getPickerPublicConfig(): PickerPublicConfig {
    const standIn = googleStandInUrl();
    if (standIn) {
        return {
            apiKey: env.client.NEXT_PUBLIC_GOOGLE_API_KEY ?? "stand-in-api-key",
            appId: env.client.NEXT_PUBLIC_GOOGLE_APP_ID ?? "stand-in-app",
            scriptUrl: `${standIn}/picker/api.js`,
        };
    }
    return {
        apiKey: env.client.NEXT_PUBLIC_GOOGLE_API_KEY ?? null,
        appId: env.client.NEXT_PUBLIC_GOOGLE_APP_ID ?? null,
        scriptUrl: GOOGLE_PICKER_SCRIPT,
    };
}

export type ConnectorProvidersStatus = Record<ConnectorProvider, { configured: boolean }>;

export function getConnectorProvidersStatus(): ConnectorProvidersStatus {
    return {
        "google-drive": { configured: isConnectorConfigured("google-drive") },
        slack: { configured: isConnectorConfigured("slack") },
        github: { configured: isConnectorConfigured("github") },
        gmail: { configured: isConnectorConfigured("gmail") },
        notion: { configured: isConnectorConfigured("notion") },
        linkedin: { configured: isConnectorConfigured("linkedin") },
        bluesky: { configured: isConnectorConfigured("bluesky") },
    };
}
