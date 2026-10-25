/**
 * The picked-items list — what an admin selected in the Google Picker or
 * pasted as a Drive link. POST upserts (the same selection must converge)
 * and takes either `{ items }` from the Picker or `{ link }`, which is
 * resolved against Drive here (it needs folder access), plus the
 * `destination` folder Add source picked — checked like an upload into it;
 * either way the changes-feed cursor is reset so the next sync walks the new
 * pick. DELETE removes by file id. Drive-only.
 */

import { z } from "zod";

import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { MAX_FOLDER_PATH_CHARS, normalizeFolderPath } from "~/lib/folders/path";
import { canEditFolder } from "~/server/services/folder-access";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordCopy } from "~/i18n/translate";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import { resolveDriveLink } from "~/server/services/connectors/google-drive/resolve-link";
import {
    addPickedItems,
    listPickedItems,
    removePickedItems,
    resetSyncCursor,
} from "~/server/services/connectors/google-drive/store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

/** The folder chosen in Add source's destination bar; absent → the old placement. */
const Destination = z.string().trim().min(1).max(MAX_FOLDER_PATH_CHARS).optional();

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
    destination: Destination,
});

const AddLinkSchema = z.object({
    link: z.string().trim().min(1).max(2048),
    destination: Destination,
});

const AddSchema = z.union([AddItemsSchema, AddLinkSchema]);

const RemoveItemsSchema = z.object({
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(200),
});

async function driveOnly(
    params: Promise<{ provider: string }>,
    request: Request
): Promise<{ ok: true } | { ok: false; response: ReturnType<typeof createValidationError> }> {
    const { provider } = await params;
    if (provider !== "google-drive") {
        const t = translatorFor(localeOfRequest(request), "sources.server.connectors");
        return { ok: false, response: createValidationError(t("pickedDriveOnly")) };
    }
    return { ok: true };
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    const t = translatorFor(localeOfRequest(request), "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const scope = await driveOnly(params, request);
            if (!scope.ok) return scope.response;

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError(t("noDrive"));

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
            return handleApiError(error, request);
        }
    });
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const scope = await driveOnly(params, request);
            if (!scope.ok) return scope.response;

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;
            if (!isConnectorConfigured("google-drive")) {
                return notConfiguredResponse("google-drive", locale);
            }

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError(t("connectDriveFirst"));
            if (connection.status !== "active") {
                return createValidationError(t("googleRevoked"));
            }

            const body = await validateRequestBody(request, AddSchema);
            if (!body.success) return body.response;

            // Picking into a folder is uploading into it: a restricted folder
            // takes edit access to it, as /api/uploadDocument checks.
            const destination = body.data.destination
                ? normalizeFolderPath(body.data.destination)
                : null;
            if (destination && !(await canEditFolder(guard.ctx, destination))) {
                return createForbiddenError(
                    translatorFor(locale, "sources.server.errors")("folderEditDenied")
                );
            }

            let added: {
                fileId: string;
                kind: "file" | "folder";
                name: string;
                mimeType: string | null;
            }[];
            if ("link" in body.data) {
                const resolved = await resolveDriveLink(connection, body.data.link);
                if (!resolved.ok) {
                    const message = wordCopy(resolved.copy, locale);
                    return resolved.reason === "not-found"
                        ? createNotFoundError(message)
                        : createValidationError(message);
                }
                added = [resolved.item];
            } else {
                added = body.data.items.map(item => ({
                    fileId: item.fileId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType ?? null,
                }));
            }

            await addPickedItems(connection.id, added, Number(guard.ctx.userPk), destination);
            await resetSyncCursor(connection.id);

            const items = await listPickedItems(connection.id);
            return createSuccessResponse(
                { count: items.length, added },
                added.length === 1
                    ? t("itemAdded", { name: added[0]!.name })
                    : t("itemsAdded", { count: added.length })
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ provider: string }> }
) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.connectors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const scope = await driveOnly(params, request);
            if (!scope.ok) return scope.response;

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) return createNotFoundError(t("noDrive"));

            const body = await validateRequestBody(request, RemoveItemsSchema);
            if (!body.success) return body.response;

            await removePickedItems(connection.id, body.data.fileIds);
            return createSuccessResponse(
                { removed: body.data.fileIds.length },
                t("selectionUpdatedDocuments")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
