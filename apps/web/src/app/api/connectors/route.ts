/**
 * Workspace connections overview.
 *
 * GET — which providers this deployment has OAuth clients for, and the
 * workspace's connections (redacted: names and status only, tokens never
 * leave the server). Any verified member may look; connecting and
 * disconnecting stay management-gated.
 */

import { inArray } from "drizzle-orm";

import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getConnectorProvidersStatus } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;

            const connections = await listConnectionsForCompany(ctx.data.companyId);

            const grantorPks = [...new Set(connections.map(row => row.grantedByUserPk))];
            const grantors =
                grantorPks.length > 0
                    ? await db
                          .select({ id: users.id, name: users.name, email: users.email })
                          .from(users)
                          .where(inArray(users.id, grantorPks))
                    : [];
            const grantorById = new Map(grantors.map(row => [row.id, row]));

            return createSuccessResponse({
                providers: getConnectorProvidersStatus(),
                connections: connections.map(row => ({
                    id: row.id.toString(),
                    provider: row.provider,
                    displayName: row.displayName,
                    status: row.status,
                    statusDetail: row.statusDetail,
                    grantedBy: grantorById.get(row.grantedByUserPk)?.name ?? null,
                    createdAt: row.createdAt.toISOString(),
                })),
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}
