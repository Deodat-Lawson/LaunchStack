/**
 * Microsoft 365 status: the single source of truth for Add source's
 * OneDrive and SharePoint panel and for Settings › Integrations. Configured,
 * connected, the account, what was picked (with where each pick's files
 * are), the last sync, and the files deleted here.
 *
 * The connection is the workspace's, so this needs `connectors.manage`,
 * like Google Drive's status. With several accounts connected the panel
 * manages the active one, or the newest when none is active.
 */

import { and, eq, inArray } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { microsoft365SourceId } from "@launchstack/pipelines/connectors/microsoft-365";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { db } from "~/server/db";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import {
    isListableDriveRow,
    listDeletedItems,
    summarizeDeletedItems,
} from "~/server/services/connectors/deleted-items";
import { primaryMicrosoft365Connection } from "~/server/services/connectors/microsoft-365/connection";
import { getSyncState, listPickedItems } from "~/server/services/connectors/microsoft-365/store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

export const runtime = "nodejs";

/** Current path of each folder a picked folder was rebuilt as. */
async function folderPaths(
    companyId: bigint,
    ids: readonly number[]
): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(and(eq(category.companyId, companyId), inArray(category.id, [...ids])));
    return new Map(rows.map(row => [Number(row.id), row.name]));
}

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            const configured = isConnectorConfigured("microsoft-365");
            if (!configured) {
                return createSuccessResponse({ configured: false, connected: false });
            }

            const connection = await primaryMicrosoft365Connection(guard.ctx.companyId);
            if (!connection) {
                return createSuccessResponse({ configured: true, connected: false });
            }

            const [pickedItems, syncState, deletedRows] = await Promise.all([
                listPickedItems(connection.id),
                getSyncState(connection.id),
                listDeletedItems([connection.id]),
            ]);
            const [paths, scope] = await Promise.all([
                folderPaths(
                    guard.ctx.companyId,
                    pickedItems.flatMap(item =>
                        item.folderCategoryId == null ? [] : [item.folderCategoryId]
                    )
                ),
                guard.ctx.documentScope(),
            ]);
            // A folder may be private to whoever picked into it (ADR-014);
            // another admin learns that it was imported, never where.
            const visiblePath = (categoryId: number | null) => {
                const path = categoryId == null ? undefined : paths.get(categoryId);
                return path && scopeAllowsCategory(scope, path) ? path : null;
            };
            const visibleDestination = (destination: string | null) =>
                destination && scopeAllowsCategory(scope, destination) ? destination : null;

            return createSuccessResponse({
                configured: true,
                connected: true,
                connectionId: String(connection.id),
                status: connection.status,
                accountEmail: connection.providerAccountEmail,
                pickedItems: pickedItems.map(item => {
                    const base = {
                        sourceId: microsoft365SourceId(item.driveId, item.itemId),
                        driveId: item.driveId,
                        itemId: item.itemId,
                        kind: item.kind,
                        name: item.name,
                        mimeType: item.mimeType,
                        webUrl: item.webUrl,
                    };
                    return item.kind === "folder"
                        ? {
                              ...base,
                              // Where a picked folder's files are; null until its
                              // first sync, and for a folder the caller can't open.
                              folderPath: visiblePath(item.folderCategoryId),
                              folderHidden:
                                  item.folderCategoryId != null &&
                                  paths.has(item.folderCategoryId) &&
                                  visiblePath(item.folderCategoryId) === null,
                          }
                        : {
                              ...base,
                              folderPath: visibleDestination(item.destination),
                              folderHidden:
                                  item.destination != null &&
                                  visibleDestination(item.destination) === null,
                          };
                }),
                lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: syncState?.lastSyncStatus ?? null,
                lastSyncError: syncState?.lastSyncError ?? null,
                lastSyncReport: syncState?.lastSyncReport ?? null,
                // Deleted here, so not synced back; named only to whoever deleted them.
                deletedHere: summarizeDeletedItems(deletedRows, Number(guard.ctx.userPk), {
                    listable: isListableDriveRow,
                }),
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
