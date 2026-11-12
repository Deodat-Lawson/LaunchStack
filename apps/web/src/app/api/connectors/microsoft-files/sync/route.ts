/**
 * "Sync now" for OneDrive and SharePoint: emits the Inngest event and
 * returns 202. The sync itself runs only in the worker (ADR-003: apps/web
 * hosts no durable work); the UI polls the status route while
 * lastSyncStatus is "running". Needs `connectors.manage`.
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
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { primaryMicrosoft365Connection } from "~/server/services/connectors/microsoft-365/connection";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

const SyncRequestSchema = z.object({
    force: z.boolean().optional(),
});

function parseBody(raw: string): unknown {
    if (!raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.microsoft365");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured("microsoft-365")) {
                return notConfiguredResponse("microsoft-365", locale);
            }

            const parsed = SyncRequestSchema.safeParse(parseBody(await request.text()));
            if (!parsed.success) return createValidationError(t("invalidBody"));

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) return createNotFoundError(t("connectFirst"));
            if (connection.status !== "active") return createValidationError(t("revoked"));

            await inngest.send({
                name: "microsoft-365/sync.requested",
                data: {
                    connectionId: String(connection.id),
                    companyId: guard.ctx.companyId.toString(),
                    force: parsed.data.force,
                },
            });

            return createSuccessResponse({ queued: true }, t("syncStarted"), 202);
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
