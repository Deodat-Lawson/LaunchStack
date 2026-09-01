/**
 * The picked-items list — what the admin selected in the Google Picker.
 * POST upserts (re-picking is how a drive.file folder grant is refreshed, so
 * the same selection must converge); DELETE removes by file id. Drive-only.
 */

import { z } from "zod";

import {
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import {
    addPickedItems,
    listPickedItems,
    removePickedItems,
} from "~/server/services/connectors/google-drive/store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

const AddItemsSchema = z.object({
    items: z
        .array(
            z.object({
                fileId: z.string().min(1).max(128),
                kind: z.enum(["file", "folder"]),
                name: z.string().min(1).max(1024),
                mimeType: z.string().max(255).nullish(),
            })
        )
        .min(1)
        .max(200),
});

const RemoveItemsSchema = z.object({
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(200),
});

async function driveOnly(
    params: Promise<{ provider: string }>
): Promise<{ ok: true } | { ok: false; response: ReturnType<typeof createValidationError> }> {
    const { provider } = await params;
    if (provider !== "google-drive") {
        return {
            ok: false,
            response: createValidationError("Picked items exist only for google-drive."),
        };
    }
    return { ok: true };
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const scope = await driveOnly(params);
            if (!scope.ok) return scope.response;

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError("No Google Drive connection.");

            const items = await listPickedItems(connection.id);
            return createSuccessResponse({
                items: items.map(item => ({
                    fileId: item.fileId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType,
                })),
            });
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const scope = await driveOnly(params);
            if (!scope.ok) return scope.response;

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

            const body = await validateRequestBody(request, AddItemsSchema);
            if (!body.success) return body.response;

            await addPickedItems(
                connection.id,
                body.data.items.map(item => ({
                    fileId: item.fileId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType ?? null,
                })),
                Number(guard.ctx.userPk)
            );

            const items = await listPickedItems(connection.id);
            return createSuccessResponse(
                { count: items.length },
                `${body.data.items.length} item(s) added.`
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const scope = await driveOnly(params);
            if (!scope.ok) return scope.response;

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError("No Google Drive connection.");

            const body = await validateRequestBody(request, RemoveItemsSchema);
            if (!body.success) return body.response;

            await removePickedItems(connection.id, body.data.fileIds);
            return createSuccessResponse(
                { removed: body.data.fileIds.length },
                "Selection updated. Already-imported documents were kept."
            );
        } catch (error) {
            return handleApiError(error);
        }
    });
}
