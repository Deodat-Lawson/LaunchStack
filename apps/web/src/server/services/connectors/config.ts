/**
 * Workspace-connection configuration, derived from env in one place.
 *
 * "Configured" requires the provider's OAuth client pair AND the secret-box
 * key — without EMBEDDING_SECRETS_KEY there is nowhere safe to put a token,
 * so a provider declines to exist rather than store one in plaintext.
 */

import { env } from "~/env";
import type { ConnectorProvider } from "~/server/db/schema/connectors";
import { CONNECTOR_PROVIDERS } from "~/server/db/schema/connectors";
import * as github from "./providers/github";
import * as google from "./providers/google";
import * as slack from "./providers/slack";
import type { ProviderGrant, ProviderOAuthConfig, RefreshedProviderToken } from "./providers/types";

export function connectorCallbackPath(provider: ConnectorProvider): string {
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

export const PROVIDER_MODULES: Record<ConnectorProvider, ProviderModule> = {
    "google-drive": google,
    slack: slack,
    github: github,
};

function clientPair(
    provider: ConnectorProvider
): { clientId: string; clientSecret: string } | null {
    const pairs: Record<ConnectorProvider, [string | undefined, string | undefined]> = {
        "google-drive": [env.server.GOOGLE_DRIVE_CLIENT_ID, env.server.GOOGLE_DRIVE_CLIENT_SECRET],
        slack: [env.server.SLACK_CLIENT_ID, env.server.SLACK_CLIENT_SECRET],
        github: [env.server.GITHUB_OAUTH_CLIENT_ID, env.server.GITHUB_OAUTH_CLIENT_SECRET],
    };
    const [clientId, clientSecret] = pairs[provider];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isConnectorConfigured(provider: ConnectorProvider): boolean {
    // The redirect URI falls back to the request origin, so APP_PUBLIC_URL is
    // not part of "configured".
    return Boolean(clientPair(provider) && env.server.EMBEDDING_SECRETS_KEY);
}

/**
 * @param requestOrigin Origin of the current request (e.g. `http://localhost:3000`),
 * used only when APP_PUBLIC_URL is not set.
 */
export function getConnectorConfig(
    provider: ConnectorProvider,
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
    return Object.fromEntries(
        CONNECTOR_PROVIDERS.map(provider => [
            provider,
            { configured: isConnectorConfigured(provider) },
        ])
    ) as ConnectorProvidersStatus;
}
