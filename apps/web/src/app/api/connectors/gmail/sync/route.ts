/**
 * "Sync now" for the caller's mailbox — emits the Inngest event and returns
 * 202. The sync itself runs only in the worker (ADR-003); the panel polls
 * GET /api/connectors/gmail while lastSyncStatus is "running".
 */

import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { createSuccessResponse, createValidationError, handleApiError } from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";
import {
    requireGmailWriter,
    requireOwnActiveGmailConnection,
} from "~/server/services/connectors/gmail/guard";
import { listScope } from "~/server/services/connectors/gmail/store";

export const runtime = "nodejs";

const SyncRequestSchema = z.object({
    force: z.boolean().optional(),
});

export async function POST(request: Request) {
    const t = requestTranslator(request, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireGmailWriter();
            if (!guard.ok) return guard.response;
            const own = await requireOwnActiveGmailConnection(guard.ctx);
            if (!own.ok) return own.response;

            const raw = await request.text();
            const parsed = SyncRequestSchema.safeParse(raw.trim() ? JSON.parse(raw) : {});
            if (!parsed.success) return createValidationError(t("invalidBody"));

            const scope = await listScope(own.connection.id);
            if (scope.length === 0) {
                return createValidationError(
                    requestTranslator(request, "sources.server.gmail")("pickSomething")
                );
            }

            await inngest.send({
                name: "gmail/sync.requested",
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
