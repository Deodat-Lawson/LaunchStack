/**
 * Disconnect a workspace connection.
 *
 * DELETE — management-gated. Removes the row; for the generic OAuth providers
 * (Slack, GitHub, LinkedIn, Notion) and Gmail it then best-effort revokes the
 * grant at the provider so a copied token dies with the connection (Drive
 * rows are simply deleted — the Drive services own no revocation endpoint,
 * matching DELETE /api/connectors/google). Documents a connection imported
 * are kept.
 * Cross-tenant deletes are impossible: the row must belong to the caller's
 * active workspace. A member disconnects their own Gmail through
 * DELETE /api/connectors/gmail; this route is the admin's offboarding path.
 */

import { requestTranslator } from "~/i18n/server";
import { createNotFoundError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    getConnectorConfig,
    isOAuthProvider,
    PROVIDER_MODULES,
} from "~/server/services/connectors/config";
import { deleteConnection, getConnectionById } from "~/server/services/connectors/connection-store";
import { revokeGoogleToken } from "~/server/services/connectors/gmail/connections";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import { publicOrigin } from "~/server/public-origin";

export const runtime = "nodejs";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ connectionId: string }> }
) {
    const t = requestTranslator(request, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const { connectionId } = await params;
            const id = Number(connectionId);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return createNotFoundError(t("connectionNotFound"));
            }

            const connection = await getConnectionById(id);
            if (!connection || connection.companyId !== guard.ctx.companyId) {
                return createNotFoundError(t("connectionNotFound"));
            }

            const provider = connection.provider;
            const tokens = await deleteConnection(id);

            // Best-effort provider-side revocation; the row is already gone.
            // Slack's auth.revoke and GitHub's grant delete want the access token.
            let revoked = false;
            if (isOAuthProvider(provider)) {
                const config = getConnectorConfig(provider, publicOrigin(request));
                const token = tokens?.accessToken ?? tokens?.refreshToken;
                if (config && token) {
                    try {
                        revoked = await PROVIDER_MODULES[provider].revokeToken(config, token);
                    } catch (error) {
                        console.error(`[connectors] ${provider} revocation failed:`, error);
                    }
                }
            } else if (provider === "gmail" && tokens?.refreshToken) {
                revoked = await revokeGoogleToken(tokens.refreshToken);
            }

            return createSuccessResponse(
                { deleted: true, providerRevoked: revoked },
                t(revoked ? "disconnectedRevoked" : "disconnectedNotRevoked")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
