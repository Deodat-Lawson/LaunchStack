/**
 * "Sync now" — emits the Inngest event and returns 202. The sync itself runs
 * only in the worker (ADR-003: apps/web hosts no durable work); the UI polls
 * the status route while lastSyncStatus is "running". Drive-only.
 */

import { z } from "zod";

import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

const SyncRequestSchema = z.object({
    force: z.boolean().optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { provider } = await params;
            if (provider !== "google-drive") {
                return createValidationError("Sync exists only for google-drive.");
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured("google-drive")) {
                return notConfiguredResponse("google-drive");
            }

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError("Connect Google Drive first.");
            if (connection.status !== "active") {
                return createValidationError("Google access was revoked — reconnect first.");
            }

            const raw = await request.text();
            const parsed = SyncRequestSchema.safeParse(raw.trim() ? JSON.parse(raw) : {});
            if (!parsed.success) return createValidationError("Invalid request body.");

            await inngest.send({
                name: "google-drive/sync.requested",
                data: {
                    connectionId: connection.id.toString(),
                    companyId: guard.ctx.companyId.toString(),
                    force: parsed.data.force,
                },
            });

            return createSuccessResponse({ queued: true }, "Sync started.", 202);
        } catch (error) {
            return handleApiError(error);
        }
    });
}
