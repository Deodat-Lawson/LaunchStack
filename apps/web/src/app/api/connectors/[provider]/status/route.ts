/**
 * Connector status for the providers with their own panel — the panel's
 * single source of truth. Google Drive: configured / connected / account /
 * picked items / last sync, plus the public Picker config. Notion: every
 * connected Notion workspace with its folder and last sync
 * (`loadNotionStatus`). Other providers have no per-provider detail and are
 * served by GET /api/connectors.
 *
 * With several Drive accounts connected, the panel manages the primary
 * (oldest) connection; the rest appear in the generic connections list.
 *
 * `folderAccess` says whether a picked folder can be imported at all: the
 * operator must have turned it on, and this connection must hold the grant
 * (connecting asks only for drive.file; "Allow folder access" adds it).
 */

import { and, eq, inArray } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { createSuccessResponse, createValidationError, handleApiError } from "~/lib/api-utils";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import { requestTranslator } from "~/i18n/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { getPickerPublicConfig, isConnectorConfigured } from "~/server/services/connectors/config";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import { getSyncState, listPickedItems } from "~/server/services/connectors/google-drive/store";
import { loadNotionStatus } from "~/server/services/connectors/notion/status";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import { db } from "~/server/db";
import {
    grantsFolderAccess,
    isDriveFolderAccessEnabled,
} from "~/server/services/google-drive/config";

/** Current path of each folder a picked Drive folder was rebuilt as. */
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

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        try {
            const { provider } = await params;
            if (provider !== "google-drive" && provider !== "notion") {
                return createValidationError(
                    requestTranslator(request, "sources.server.connectors")("statusDriveNotionOnly")
                );
            }

            const guard = await requireConnectorAdmin();
            if (!guard.ok) return guard.response;

            if (provider === "notion") {
                return createSuccessResponse(await loadNotionStatus(guard.ctx));
            }

            const configured = isConnectorConfigured("google-drive");
            const picker = getPickerPublicConfig();
            const folderAccessEnabled = isDriveFolderAccessEnabled();
            if (!configured) {
                return createSuccessResponse({
                    configured: false,
                    connected: false,
                    picker,
                    folderAccess: { enabled: folderAccessEnabled, granted: false },
                });
            }

            const [connection] = await listConnectionsForCompany(
                guard.ctx.companyId,
                "google-drive"
            );
            if (!connection) {
                return createSuccessResponse({
                    configured: true,
                    connected: false,
                    picker,
                    folderAccess: { enabled: folderAccessEnabled, granted: false },
                });
            }

            const [pickedItems, syncState] = await Promise.all([
                listPickedItems(connection.id),
                getSyncState(connection.id),
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
            // A picked folder is private to whoever picked it (ADR-014); another
            // admin learns that it was imported, never what it is called now.
            const visiblePath = (categoryId: number | null) => {
                const path = categoryId == null ? undefined : paths.get(categoryId);
                return path && scopeAllowsCategory(scope, path) ? path : null;
            };
            return createSuccessResponse({
                configured: true,
                connected: true,
                connectionId: String(connection.id),
                status: connection.status,
                accountEmail: connection.providerAccountEmail,
                folderAccess: {
                    enabled: folderAccessEnabled,
                    granted: grantsFolderAccess(connection.scopes),
                },
                pickedItems: pickedItems.map(item => ({
                    fileId: item.fileId,
                    kind: item.kind,
                    name: item.name,
                    mimeType: item.mimeType,
                    // Where a picked folder's files are; null until its first sync,
                    // and for a folder the caller can't open (folderHidden).
                    folderPath: visiblePath(item.folderCategoryId),
                    folderHidden:
                        item.folderCategoryId != null &&
                        paths.has(item.folderCategoryId) &&
                        visiblePath(item.folderCategoryId) === null,
                })),
                lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: syncState?.lastSyncStatus ?? null,
                lastSyncError: syncState?.lastSyncError ?? null,
                lastSyncReport: syncState?.lastSyncReport ?? null,
                picker,
            });
        } catch (error) {
            return handleApiError(error, request);
        }
    });
}
