/**
 * Disconnect a workspace connection.
 *
 * DELETE — management-gated. Removes the row; for Slack/GitHub it then
 * best-effort revokes the grant at the provider so a copied token dies with
 * the connection (Google rows are simply deleted — the Drive services own no
 * revocation endpoint, matching DELETE /api/connectors/google). Cross-tenant
 * deletes are impossible: the row must belong to the caller's active
 * workspace.
 */

import { createNotFoundError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    getConnectorConfig,
    isOAuthProvider,
    PROVIDER_MODULES,
} from "~/server/services/connectors/config";
import { deleteConnection, getConnectionById } from "~/server/services/connectors/connection-store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ connectionId: string }> }
) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const { connectionId } = await params;
            const id = Number(connectionId);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return createNotFoundError("Connection not found.");
            }

            const connection = await getConnectionById(id);
            if (!connection || connection.companyId !== guard.ctx.companyId) {
                return createNotFoundError("Connection not found.");
            }

            const provider = connection.provider;
            const tokens = await deleteConnection(id);

            // Best-effort provider-side revocation; the row is already gone.
            // Slack's auth.revoke and GitHub's grant delete want the access token.
            let revoked = false;
            if (isOAuthProvider(provider)) {
                const config = getConnectorConfig(provider, new URL(request.url).origin);
                const token = tokens?.accessToken ?? tokens?.refreshToken;
                if (config && token) {
                    try {
                        revoked = await PROVIDER_MODULES[provider].revokeToken(config, token);
                    } catch (error) {
                        console.error(`[connectors] ${provider} revocation failed:`, error);
                    }
                }
            }

            return createSuccessResponse(
                { deleted: true, providerRevoked: revoked },
                revoked
                    ? "Disconnected and revoked at the provider."
                    : "Disconnected. The provider-side grant may still exist — revoke it from the provider's security settings if needed."
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
