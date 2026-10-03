/**
 * Mint a short-lived (~1h) access token for the Google Picker. Exposing it to
 * the browser is inherent to how the Picker works, and only connectors.manage
 * holders of the owning workspace can fetch it.
 *
 * What the token can read depends on the grant. Under drive.file alone it
 * reaches only files this app was handed or created (though the Picker itself
 * lets its holder browse and pick anything in the connected account). With
 * folder import on (drive.readonly) it can read the connected account's whole
 * Drive directly. Google documents no way to mint a narrower token from the
 * same refresh token, so every admin of the workspace — and anything running
 * in an admin's page — can read that account's Drive for the token's life.
 * That is the trade the operator accepts with GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED.
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
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
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

            const accessToken = await getAccessTokenForConnection(connection);
            return createSuccessResponse({ accessToken });
        } catch (error) {
            return handleApiError(error);
        }
    });
}
