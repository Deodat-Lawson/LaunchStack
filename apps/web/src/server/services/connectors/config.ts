/**
 * Workspace-connection configuration, derived from env in one place.
 *
 * Google Drive connects through its own flow (`/api/connectors/google/oauth/*`
 * and `~/server/services/google-drive/*` — the OAuth client pair is
 * GOOGLE_OAUTH_CLIENT_ID/SECRET); this module owns the generic layer that
 * serves Slack and GitHub, plus the cross-provider status map the UI reads.
 *
 * "Configured" requires the provider's OAuth client pair AND the secret-box
 * key — without EMBEDDING_SECRETS_KEY there is nowhere safe to put a token,
 * so a provider declines to exist rather than store one in plaintext.
 */

import { env } from "~/env";
import type { ConnectorProvider } from "~/server/db/schema/connectors";
import * as github from "./providers/github";
import * as slack from "./providers/slack";
import type { ProviderGrant, ProviderOAuthConfig, RefreshedProviderToken } from "./providers/types";

/** The providers whose OAuth handshake this generic layer performs. */
export const OAUTH_PROVIDERS = ["slack", "github"] as const;
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
};

function clientPair(provider: OAuthProvider): { clientId: string; clientSecret: string } | null {
    const pairs: Record<OAuthProvider, [string | undefined, string | undefined]> = {
        slack: [env.server.SLACK_CLIENT_ID, env.server.SLACK_CLIENT_SECRET],
        github: [env.server.GITHUB_OAUTH_CLIENT_ID, env.server.GITHUB_OAUTH_CLIENT_SECRET],
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
    return Boolean(clientPair(provider));
}

/**
 * @param requestOrigin Origin of the current request (e.g. `http://localhost:3000`),
 * used only when APP_PUBLIC_URL is not set.
 */
export function getConnectorConfig(
    provider: OAuthProvider,
    requestOrigin?: string
): ProviderOAuthConfig | null {
    const pair = clientPair(provider);
    if (!pair || !env.server.EMBEDDING_SECRETS_KEY) return null;

    const base = env.server.APP_PUBLIC_URL ?? requestOrigin;
    if (!base) return null;

    return {
        ...pair,
        redirectUri: new URL(connectorCallbackPath(provider), base).toString(),
    };
}

/** Browser-side Google Picker config; both values are public by design. */
export function getPickerPublicConfig(): { apiKey: string | null; appId: string | null } {
    return {
        apiKey: env.client.NEXT_PUBLIC_GOOGLE_API_KEY ?? null,
        appId: env.client.NEXT_PUBLIC_GOOGLE_APP_ID ?? null,
    };
}

export type ConnectorProvidersStatus = Record<ConnectorProvider, { configured: boolean }>;

export function getConnectorProvidersStatus(): ConnectorProvidersStatus {
    return {
        "google-drive": { configured: isConnectorConfigured("google-drive") },
        slack: { configured: isConnectorConfigured("slack") },
        github: { configured: isConnectorConfigured("github") },
    };
}
