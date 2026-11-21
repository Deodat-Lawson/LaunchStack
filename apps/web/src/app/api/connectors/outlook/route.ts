/**
 * GET    /api/connectors/outlook: the caller's own Outlook connection:
 *        configured / connected / account / folder / chosen mail folders and
 *        searches / last sync. The Outlook panel's single source of truth.
 *        Any member may look; the answer is always about their own mailbox.
 * DELETE /api/connectors/outlook: disconnect the caller's own mailbox. The
 *        row (and its state and scope) is deleted, which deletes our only
 *        copy of the refresh token and stops the sync. Microsoft offers no
 *        endpoint for a server app to revoke that token, so the response
 *        says where the member can remove the app on Microsoft's side. The
 *        synced documents stay in the private folder.
 */

import { requestTranslator } from "~/i18n/server";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { recordAuditEvent } from "~/lib/authz/audit";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { db } from "~/server/db";
import { OUTLOOK_CONNECT_URL, outlookFolderFor } from "~/server/services/connectors/outlook/config";
import { requireOutlookReader } from "~/server/services/connectors/outlook/guard";
import {
    deleteOutlookConnection,
    getSyncState,
    listScope,
} from "~/server/services/connectors/outlook/store";
import { isOutlookConnectorConfigured } from "~/server/services/microsoft/config";
import { getOutlookConnectionForUser } from "~/server/services/microsoft/connections";

export const runtime = "nodejs";

/** Where a member removes an app from their Microsoft account. */
const MICROSOFT_APPS_URL = "https://myapps.microsoft.com";

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireOutlookReader();
            if (!guard.ok) return guard.response;
            const { ctx } = guard;

            const configured = isOutlookConnectorConfigured();
            const canConnect = ctx.can("documents.upload");
            // Operators are told which switch to flip; everyone else is told whom to ask.
            const canConfigure = ctx.can("connectors.manage");

            // A connection made before the server switch was turned off is
            // still the member's to see and remove.
            const connection = await getOutlookConnectionForUser(ctx.companyId, ctx.userPk);
            if (!connection) {
                return createSuccessResponse({
                    configured,
                    connected: false,
                    canConnect,
                    canConfigure,
                    ...(configured ? { connectUrl: OUTLOOK_CONNECT_URL } : {}),
                });
            }

            const [scope, syncState] = await Promise.all([
                listScope(connection.id),
                getSyncState(connection.id),
            ]);
            return createSuccessResponse({
                configured,
                connected: true,
                canConnect,
                canConfigure,
                connectUrl: OUTLOOK_CONNECT_URL,
                connectionId: String(connection.id),
                status: connection.status,
                statusDetail: connection.lastRefreshError,
                accountEmail: connection.providerAccountEmail,
                folder: outlookFolderFor(connection.providerAccountEmail ?? "mailbox"),
                scope: scope.map(row => ({
                    id: row.id.toString(),
                    kind: row.kind,
                    value: row.value,
                    name: row.name,
                })),
                lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: syncState?.lastSyncStatus ?? null,
                lastSyncError: syncState?.lastSyncError ?? null,
                lastSyncReport: syncState?.lastSyncReport ?? null,
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireOutlookReader();
            if (!guard.ok) return guard.response;
            const { ctx } = guard;

            const connection = await getOutlookConnectionForUser(ctx.companyId, ctx.userPk);
            if (!connection) {
                return createSuccessResponse({ deleted: false, providerRevoked: false });
            }

            await deleteOutlookConnection(connection.id);

            await recordAuditEvent(db, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "connector.disconnected",
                targetType: "connector",
                targetId: "outlook",
                detail: {
                    connectionId: connection.id,
                    accountEmail: connection.providerAccountEmail,
                    // Never true: Microsoft has no revocation endpoint to call.
                    providerRevoked: false,
                },
            });

            return createSuccessResponse(
                { deleted: true, providerRevoked: false, removeAppUrl: MICROSOFT_APPS_URL },
                requestTranslator(request, "sources.server.outlook")("disconnected")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
