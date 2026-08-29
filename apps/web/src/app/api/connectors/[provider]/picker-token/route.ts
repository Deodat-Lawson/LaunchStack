/**
 * Mint a short-lived access token for the Google Picker. Exposing this to the
 * browser is inherent to how the Picker works and acceptable by construction:
 * the token is drive.file-scoped (it can see only what this app was already
 * granted) and only management roles of the owning workspace can fetch it.
 */

import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import {
    getConnectionAccessToken,
    listConnectionsForCompany,
} from "~/server/services/connectors/connection-store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { provider } = await params;
            if (provider !== "google-drive") {
                return createValidationError("Picker tokens exist only for google-drive.");
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured("google-drive")) {
                return notConfiguredResponse("google-drive");
            }

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection || connection.status !== "active") {
                return createNotFoundError("No active Google Drive connection.");
            }

            const accessToken = await getConnectionAccessToken(connection);
            return createSuccessResponse({ accessToken });
        } catch (error) {
            return handleApiError(error);
        }
    });
}
