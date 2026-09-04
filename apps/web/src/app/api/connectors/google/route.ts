/**
 * GET  /api/connectors/google — connection status for the settings panel.
 * DELETE /api/connectors/google — disconnect (revokes our stored grant; the
 * files in the Google account are untouched, linked documents stop syncing
 * and surface a reconnect banner).
 */
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { isDriveLinkingEnabled } from "~/server/services/google-drive/config";
import {
    disconnectGoogleConnections,
    getActiveGoogleConnection,
} from "~/server/services/google-drive/connections";

export async function GET() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    if (!isDriveLinkingEnabled()) {
        return NextResponse.json({ enabled: false, connected: false });
    }

    const connection = await getActiveGoogleConnection(BigInt(ctx.data.companyId));
    return NextResponse.json({
        enabled: true,
        connected: Boolean(connection),
        accountEmail: connection?.providerAccountEmail ?? null,
        connectUrl: "/api/connectors/google/oauth/start",
    });
}

export async function DELETE() {
    const ctx = await requireWorkspacePermission("connectors.manage");
    if (!ctx.success) return ctx.response;

    const revoked = await disconnectGoogleConnections(BigInt(ctx.data.companyId));
    if (revoked > 0) {
        await recordAuditEvent(db, {
            companyId: ctx.data.companyId,
            actorUserId: ctx.data.authUserId,
            action: "connector.disconnected",
            targetType: "connector",
            targetId: "google-drive",
            detail: { revoked },
        });
    }
    return NextResponse.json({ success: true, revoked });
}
