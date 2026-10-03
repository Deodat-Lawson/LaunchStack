/**
 * GET    /api/connectors/gmail — the caller's own Gmail connection: configured
 *        / connected / account / folder / selected labels and searches / last
 *        sync. The Gmail panel's single source of truth. Any member may look;
 *        the answer is always about their own mailbox.
 * DELETE /api/connectors/gmail — disconnect the caller's own mailbox. The row
 *        (and its state and scope) is deleted, the grant is revoked at Google
 *        best-effort, and the synced documents stay in the private folder.
 */

import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { recordAuditEvent } from "~/lib/authz/audit";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { db } from "~/server/db";
import {
    gmailFolderFor,
    isGmailConnectorConfigured,
} from "~/server/services/connectors/gmail/config";
import {
    deleteGmailConnection,
    getGmailConnectionForUser,
    revokeGoogleToken,
} from "~/server/services/connectors/gmail/connections";
import { requireGmailReader } from "~/server/services/connectors/gmail/guard";
import { getSyncState, listScope } from "~/server/services/connectors/gmail/store";

export const runtime = "nodejs";

const CONNECT_URL = "/api/connectors/google/oauth/start?provider=gmail";

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireGmailReader();
            if (!guard.ok) return guard.response;
            const { ctx } = guard;

            const configured = isGmailConnectorConfigured();
            const canConnect = ctx.can("documents.upload");
            if (!configured) {
                return createSuccessResponse({ configured: false, connected: false, canConnect });
            }

            const connection = await getGmailConnectionForUser(ctx.companyId, ctx.userPk);
            if (!connection) {
                return createSuccessResponse({
                    configured: true,
                    connected: false,
                    canConnect,
                    connectUrl: CONNECT_URL,
                });
            }

            const [scope, syncState] = await Promise.all([
                listScope(connection.id),
                getSyncState(connection.id),
            ]);
            return createSuccessResponse({
                configured: true,
                connected: true,
                canConnect,
                connectUrl: CONNECT_URL,
                connectionId: String(connection.id),
                status: connection.status,
                statusDetail: connection.lastRefreshError,
                accountEmail: connection.providerAccountEmail,
                folder: gmailFolderFor(connection.providerAccountEmail ?? "mailbox"),
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
            return handleApiError(error);
        }
    });
}

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireGmailReader();
            if (!guard.ok) return guard.response;
            const { ctx } = guard;

            const connection = await getGmailConnectionForUser(ctx.companyId, ctx.userPk);
            if (!connection)
                return createSuccessResponse({ deleted: false, providerRevoked: false });

            const tokens = await deleteGmailConnection(connection.id);
            const revoked = tokens?.refreshToken
                ? await revokeGoogleToken(tokens.refreshToken)
                : false;

            await recordAuditEvent(db, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "connector.disconnected",
                targetType: "connector",
                targetId: "gmail",
                detail: {
                    connectionId: connection.id,
                    accountEmail: connection.providerAccountEmail,
                    providerRevoked: revoked,
                },
            });

            return createSuccessResponse(
                { deleted: true, providerRevoked: revoked },
                revoked
                    ? "Gmail disconnected. Synced emails were kept in your folder."
                    : "Gmail disconnected. Synced emails were kept; if Google still lists LaunchStack under your account's connected apps, remove it there."
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
