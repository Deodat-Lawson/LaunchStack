/**
 * What the workspace syncs from OneDrive and SharePoint: the picked files
 * and folders. POST adds picks, either `{ link }` (a pasted sharing link,
 * resolved by Microsoft as the connected account) or `{ items }` (drive and
 * item ids from the built-in browser, looked up again here so the name, kind
 * and address stored are Microsoft's, not the client's), plus the
 * `destination` folder Add source picked, checked like an upload into it.
 * Picking something again lets back in what was deleted here under it.
 * DELETE stops syncing picks; documents already imported are kept.
 *
 * Every run walks the picks, so there is no cursor to reset: the caller
 * asks for a sync (POST ../sync) and the new pick comes in.
 */

import { z } from "zod";

import {
    createMicrosoft365Client,
    Microsoft365AccessError,
    microsoft365SourceId,
} from "@launchstack/pipelines/connectors/microsoft-365";
import {
    createForbiddenError,
    createNotFoundError,
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { MAX_FOLDER_PATH_CHARS, normalizeFolderPath } from "~/lib/folders/path";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordCopy } from "~/i18n/translate";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { forgetDeletedUnderPicks } from "~/server/services/connectors/deleted-items";
import { primaryMicrosoft365Connection } from "~/server/services/connectors/microsoft-365/connection";
import {
    pickedItemFromGraph,
    resolveMicrosoft365Link,
} from "~/server/services/connectors/microsoft-365/resolve-link";
import {
    addPickedItems,
    listPickedItems,
    removePickedItems,
    type PickedItemInput,
} from "~/server/services/connectors/microsoft-365/store";
import {
    notConfiguredResponse,
    requireConnectorAdmin,
} from "~/server/services/connectors/workspace-guard";
import { canEditFolder } from "~/server/services/folder-access";
import { graphApiBaseUrl } from "~/server/services/microsoft/config";
import { getMicrosoftAccessToken } from "~/server/services/microsoft/connections";

export const runtime = "nodejs";

/** The folder chosen in Add source's destination bar. */
const Destination = z.string().trim().min(1).max(MAX_FOLDER_PATH_CHARS).optional();

const ItemRef = z.object({
    driveId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
});

const AddItemsSchema = z.object({
    items: z.array(ItemRef).min(1).max(50),
    destination: Destination,
});

const AddLinkSchema = z.object({
    link: z.string().trim().min(1).max(2048),
    destination: Destination,
});

const AddSchema = z.union([AddItemsSchema, AddLinkSchema]);

const RemoveItemsSchema = z.object({
    items: z.array(ItemRef).min(1).max(200),
});

export async function GET(request: Request) {
    const t = translatorFor(localeOfRequest(request), "sources.server.microsoft365");
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) return createNotFoundError(t("notConnected"));

            const items = await listPickedItems(connection.id);
            return createSuccessResponse({
                items: items.map(item => ({
                    driveId: item.driveId,
                    itemId: item.itemId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType,
                    webUrl: item.webUrl,
                })),
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
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

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) return createNotFoundError(t("connectFirst"));
            if (connection.status !== "active") return createValidationError(t("revoked"));

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

            let added: PickedItemInput[];
            if ("link" in body.data) {
                const resolved = await resolveMicrosoft365Link(connection, body.data.link);
                if (!resolved.ok) {
                    const message = wordCopy(resolved.copy, locale);
                    return resolved.reason === "not-found"
                        ? createNotFoundError(message)
                        : createValidationError(message);
                }
                added = [resolved.item];
            } else {
                const client = createMicrosoft365Client({
                    accessToken: await getMicrosoftAccessToken(connection),
                    baseUrl: graphApiBaseUrl(),
                });
                added = [];
                for (const ref of body.data.items) {
                    try {
                        const picked = pickedItemFromGraph(
                            await client.getItem(ref.driveId, ref.itemId),
                            ref.driveId
                        );
                        if (!picked) return createValidationError(t("itemUnsupported"));
                        added.push(picked);
                    } catch (error) {
                        if (error instanceof Microsoft365AccessError) {
                            return createNotFoundError(t("itemNotFound"));
                        }
                        throw error;
                    }
                }
            }

            await addPickedItems(connection.id, added, Number(guard.ctx.userPk), destination);
            // Picking it again asks for it again, including what was deleted here.
            await forgetDeletedUnderPicks(
                connection.id,
                added.map(item => microsoft365SourceId(item.driveId, item.itemId))
            );

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

export async function DELETE(request: Request) {
    const t = translatorFor(localeOfRequest(request), "sources.server.microsoft365");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) return createNotFoundError(t("notConnected"));

            const body = await validateRequestBody(request, RemoveItemsSchema);
            if (!body.success) return body.response;

            await removePickedItems(connection.id, body.data.items);
            return createSuccessResponse(
                { removed: body.data.items.length },
                t("selectionUpdated")
            );
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
