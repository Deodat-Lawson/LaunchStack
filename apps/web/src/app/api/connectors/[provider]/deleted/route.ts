/**
 * "Sync again" for synced files someone deleted in LaunchStack (see
 * connectors/deleted-items). DELETE forgets the record, so the next sync
 * imports the file like any new one; the panel then asks for that sync.
 * Body: `{ connectionId, sourceIds }` for named files, or
 * `{ connectionId, all: true }` for everything listed for that connection.
 * Google Drive and Notion only.
 *
 * Drive's changes-feed cursor is reset too: nothing changed in Drive, so an
 * idle feed would otherwise call the next run clean and bring nothing back.
 */

import { z } from "zod";

import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
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
import { resetSyncCursor } from "~/server/services/connectors/google-drive/store";
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

const PROVIDERS = ["google-drive", "notion"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(value: string): value is Provider {
    return (PROVIDERS as readonly string[]).includes(value);
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { provider } = await params;
            if (!isProvider(provider)) {
                return createValidationError(t("deletedDriveNotionOnly"));
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const body = await validateRequestBody(request, RestoreSchema);
            if (!body.success) return body.response;

            // Only this workspace's connections of this provider.
            const connections = await listConnectionsForCompany(guard.ctx.companyId, provider);
            const connection = connections.find(row => String(row.id) === body.data.connectionId);
            if (!connection) return createNotFoundError(t("connectionNotFound"));

            // A Drive file whose own pick went with it comes back by being
            // picked again; Settings never lists it, so this never forgets it.
            const listable = (await listDeletedItems([connection.id])).filter(row =>
                provider === "google-drive" ? isListableDriveRow(row) : true
            );
            const wanted = "all" in body.data ? null : new Set<string>(body.data.sourceIds);
            const sourceIds = listable
                .map(row => row.sourceId)
                .filter(id => wanted === null || wanted.has(id));

            const restored = await forgetDeletedItems(connection.id, { sourceIds });
            if (restored > 0 && provider === "google-drive") {
                await resetSyncCursor(connection.id);
            }

            return createSuccessResponse({ restored }, t("deletedRestored", { count: restored }));
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
