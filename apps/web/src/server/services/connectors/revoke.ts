/**
 * Tell a provider a deleted connection's grant is over, so a copied token
 * dies with the row. Best effort everywhere it is used: the row is already
 * gone, and a failure is logged, never surfaced.
 *
 * The generic OAuth providers (Slack, GitHub, LinkedIn, Notion) revoke with
 * the access token (Slack's auth.revoke and GitHub's grant delete want it);
 * Gmail revokes its Google refresh token. Drive rows own no revocation
 * endpoint here and are simply deleted.
 *
 * Callers await it after their change has committed (a member's removal, a
 * disconnect), so it is bounded: a provider that hangs costs at most
 * REVOKE_TIMEOUT_MS and reads as "not revoked", never a stuck request.
 */

import { getConnectorConfig, isOAuthProvider, PROVIDER_MODULES } from "./config";
import { revokeGoogleToken } from "./gmail/connections";

export interface ConnectionTokens {
    readonly accessToken: string | null;
    readonly refreshToken: string | null;
}

/** Longest a revocation may hold up the response it follows. */
export const REVOKE_TIMEOUT_MS = 5_000;

/** True when the provider confirmed the revocation in time. */
export async function revokeConnectionTokens(
    provider: string,
    tokens: ConnectionTokens | null,
    origin?: string,
    timeoutMs: number = REVOKE_TIMEOUT_MS
): Promise<boolean> {
    if (!tokens) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
            console.warn(`[connectors] ${provider} revocation timed out after ${timeoutMs}ms`);
            resolve(false);
        }, timeoutMs);
    });
    try {
        return await Promise.race([revoke(provider, tokens, origin), timedOut]);
    } finally {
        clearTimeout(timer);
    }
}

async function revoke(
    provider: string,
    tokens: ConnectionTokens,
    origin: string | undefined
): Promise<boolean> {
    try {
        if (isOAuthProvider(provider)) {
            const config = getConnectorConfig(provider, origin);
            const token = tokens.accessToken ?? tokens.refreshToken;
            if (!config || !token) return false;
            return await PROVIDER_MODULES[provider].revokeToken(config, token);
        }
        if (provider === "gmail" && tokens.refreshToken) {
            return await revokeGoogleToken(tokens.refreshToken);
        }
        // Microsoft 365 (OneDrive and SharePoint): Microsoft offers a web app
        // no endpoint to revoke one delegated refresh token, so there is
        // nothing to call. Disconnecting deletes LaunchStack's stored copy,
        // which is the only copy; the permission itself stays listed in the
        // person's Microsoft account until they or their administrator
        // remove it there, and Settings says so (`microsoft365Sync`).
        if (provider === "microsoft-365") return false;
    } catch (error) {
        console.error(`[connectors] ${provider} revocation failed:`, error);
    }
    return false;
}
