/**
 * "Sync now" — emits the Inngest event and returns 202. The sync itself runs
 * only in the worker (ADR-003: apps/web hosts no durable work); the UI polls
 * the status route while lastSyncStatus is "running".
 *
 * Google Drive syncs the workspace's primary Drive connection. Notion syncs
 * the connection named by `?connectionId=`, or every active Notion
 * connection when none is named.
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
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

const SyncRequestSchema = z.object({
    force: z.boolean().optional(),
});

const SYNC_PROVIDERS = ["google-drive", "notion"] as const;
type SyncProvider = (typeof SYNC_PROVIDERS)[number];

function isSyncProvider(value: string): value is SyncProvider {
    return (SYNC_PROVIDERS as readonly string[]).includes(value);
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { provider } = await params;
            if (!isSyncProvider(provider)) {
                return createValidationError(t("syncDriveNotionOnly"));
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured(provider)) {
                return notConfiguredResponse(provider, locale);
            }

            const raw = await request.text();
            const parsed = SyncRequestSchema.safeParse(raw.trim() ? JSON.parse(raw) : {});
            if (!parsed.success) return createValidationError(t("invalidBody"));

            const companyId = guard.ctx.companyId.toString();
            const connections = await listConnectionsForCompany(guard.ctx.companyId, provider);

            if (provider === "notion") {
                const wanted = new URL(request.url).searchParams.get("connectionId");
                const targets = connections.filter(
                    row => row.status === "active" && (!wanted || String(row.id) === wanted)
                );
                if (targets.length === 0) {
                    return wanted && connections.some(row => String(row.id) === wanted)
                        ? createValidationError(t("notionRevoked"))
                        : createNotFoundError(t("connectNotionFirst"));
                }
                await inngest.send(
                    targets.map(row => ({
                        name: "notion/sync.requested" as const,
                        data: { connectionId: String(row.id), companyId, force: parsed.data.force },
                    }))
                );
                return createSuccessResponse({ queued: targets.length }, t("syncStarted"), 202);
            }

            const [connection] = connections;
            if (!connection) return createNotFoundError(t("connectDriveFirst"));
            if (connection.status !== "active") {
                return createValidationError(t("googleRevoked"));
            }

            await inngest.send({
                name: "google-drive/sync.requested",
                data: {
                    connectionId: String(connection.id),
                    companyId,
                    force: parsed.data.force,
                },
            });

            return createSuccessResponse({ queued: true }, t("syncStarted"), 202);
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
