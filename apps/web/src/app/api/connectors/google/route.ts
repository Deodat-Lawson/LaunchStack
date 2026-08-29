/**
 * GET  /api/connectors/google — connection status for the settings panel.
 * DELETE /api/connectors/google — disconnect (revokes our stored grant; the
 * files in the Google account are untouched, linked documents stop syncing
 * and surface a reconnect banner).
 */
import { NextResponse } from "next/server";

import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";
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
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    if (!isManagementRole(ctx.data.role)) {
        return NextResponse.json(
            { error: "Forbidden: owner or admin role required" },
            { status: 403 }
        );
    }

    const revoked = await disconnectGoogleConnections(BigInt(ctx.data.companyId));
    return NextResponse.json({ success: true, revoked });
}
