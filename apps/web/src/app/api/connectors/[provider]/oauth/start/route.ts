/**
 * Start a Slack/GitHub OAuth flow: build the consent URL with an HMAC-signed
 * state, double the nonce into an httpOnly cookie, and redirect. Google Drive
 * connects through its own flow at /api/connectors/google/oauth/start.
 */

import { NextResponse } from "next/server";

import { createValidationError } from "~/lib/api-utils";
import { handleApiError } from "~/lib/api-utils";
import {
    getConnectorConfig,
    isOAuthProvider,
    PROVIDER_MODULES,
} from "~/server/services/connectors/config";
import {
    createNonce,
    oauthNonceCookieName,
    OAUTH_STATE_TTL_MS,
    signState,
} from "~/server/services/connectors/oauth-state";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    try {
        const { provider } = await params;
        if (!isOAuthProvider(provider)) {
            return createValidationError(
                provider === "google-drive"
                    ? "Google Drive connects via /api/connectors/google/oauth/start."
                    : `Unknown connector provider: ${provider}`
            );
        }

        const guard = await requireConnectorAdmin();
        if (!guard.ok) return guard.response;

        const config = getConnectorConfig(provider, new URL(request.url).origin);
        if (!config) return notConfiguredResponse(provider);

        const nonce = createNonce();
        const state = signState({
            provider,
            companyId: guard.ctx.companyId.toString(),
            userPk: Number(guard.ctx.userPk),
            nonce,
            iat: Date.now(),
        });

        const response = NextResponse.redirect(
            PROVIDER_MODULES[provider].buildAuthUrl(config, state)
        );
        response.cookies.set(oauthNonceCookieName(provider), nonce, {
            httpOnly: true,
            sameSite: "lax",
            secure: config.redirectUri.startsWith("https://"),
            path: `/api/connectors/${provider}`,
            maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
        });
        return response;
    } catch (error) {
        return handleApiError(error);
    }
}
