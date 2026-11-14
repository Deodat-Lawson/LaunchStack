/**
 * "Sync again" for OneDrive and SharePoint files someone deleted in
 * LaunchStack (see connectors/deleted-items). DELETE forgets the record, so
 * the next sync imports the file like any new one; the panel then asks for
 * that sync. Body: `{ connectionId, sourceIds }` for named files, or
 * `{ connectionId, all: true }` for everything listed for that connection.
 * The connection is the workspace's, so this needs `connectors.manage`.
 */

import { z } from "zod";

import { createNotFoundError, createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import {
    forgetDeletedItems,
    isListableDriveRow,
    listDeletedItems,
} from "~/server/services/connectors/deleted-items";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

const RestoreSchema = z.union([
    z.object({
        connectionId: z.string().regex(/^\d+$/),
        sourceIds: z.array(z.string().min(1).max(128)).min(1).max(500),
    }),
    z.object({
        connectionId: z.string().regex(/^\d+$/),
        all: z.literal(true),
    }),
]);

export async function DELETE(request: Request) {
    const t = translatorFor(localeOfRequest(request), "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const body = await validateRequestBody(request, RestoreSchema);
            if (!body.success) return body.response;

            // Only this workspace's Microsoft 365 connections.
            const connections = await listConnectionsForCompany(
                guard.ctx.companyId,
                "microsoft-365"
            );
            const connection = connections.find(row => String(row.id) === body.data.connectionId);
            if (!connection) return createNotFoundError(t("connectionNotFound"));

            // A file whose own pick went with it comes back by being picked
            // again; Settings never lists it, so this never forgets it.
            const listable = (await listDeletedItems([connection.id])).filter(isListableDriveRow);
            const wanted = "all" in body.data ? null : new Set<string>(body.data.sourceIds);
            const sourceIds = listable
                .map(row => row.sourceId)
                .filter(id => wanted === null || wanted.has(id));

            const restored = await forgetDeletedItems(connection.id, { sourceIds });
            return createSuccessResponse({ restored }, t("deletedRestored", { count: restored }));
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
