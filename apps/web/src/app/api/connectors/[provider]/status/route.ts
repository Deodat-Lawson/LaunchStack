/**
 * Google Drive connector status — the Drive panel's single source of truth:
 * configured / connected / account / picked items / last sync, plus the
 * public Picker config. Other providers have no per-provider detail yet and
 * are served by GET /api/connectors; this route is Drive-only.
 *
 * With several Drive accounts connected, the panel manages the primary
 * (oldest) connection; the rest appear in the generic connections list.
 */

import { createSuccessResponse, createValidationError, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { getPickerPublicConfig, isConnectorConfigured } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import { getSyncState, listPickedItems } from "~/server/services/connectors/google-drive/store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const { provider } = await params;
            if (provider !== "google-drive") {
                return createValidationError("Status detail exists only for google-drive.");
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const configured = isConnectorConfigured("google-drive");
            const picker = getPickerPublicConfig();
            if (!configured) {
                return createSuccessResponse({ configured: false, connected: false, picker });
            }

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) {
                return createSuccessResponse({ configured: true, connected: false, picker });
            }

            const [pickedItems, syncState] = await Promise.all([
                listPickedItems(connection.id),
                getSyncState(connection.id),
            ]);
            return createSuccessResponse({
                configured: true,
                connected: true,
                connectionId: String(connection.id),
                status: connection.status,
                accountEmail: connection.providerAccountEmail,
                pickedItems: pickedItems.map(item => ({
                    fileId: item.fileId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType,
                })),
                lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: syncState?.lastSyncStatus ?? null,
                lastSyncError: syncState?.lastSyncError ?? null,
                lastSyncReport: syncState?.lastSyncReport ?? null,
                picker,
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}
