/**
 * "Sync now" for the caller's Outlook mailbox: emits the Inngest event and
 * returns 202. The sync itself runs only in the worker (ADR-003); the panel
 * polls GET /api/connectors/outlook while lastSyncStatus is "running".
 */

import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { createSuccessResponse, createValidationError, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";
import {
    requireOutlookWriter,
    requireOwnActiveOutlookConnection,
} from "~/server/services/connectors/outlook/guard";
import { listScope } from "~/server/services/connectors/outlook/store";

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
    const t = requestTranslator(request, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireOutlookWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveOutlookConnection(guard.ctx);
            if (!own.ok) return own.response;

            const parsed = SyncRequestSchema.safeParse(parseBody(await request.text()));
            if (!parsed.success) return createValidationError(t("invalidBody"));

            const scope = await listScope(own.connection.id);
            if (scope.length === 0) {
                return createValidationError(
                    requestTranslator(request, "sources.server.outlook")("pickSomething")
                );
            }

            await inngest.send({
                name: "outlook/sync.requested",
                data: {
                    connectionId: String(own.connection.id),
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
