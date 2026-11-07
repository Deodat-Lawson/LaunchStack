/**
 * What the Notion panel shows: every Notion workspace the caller connected,
 * where its pages land, how its last sync went, and the pages deleted here.
 * Notion connections are per-user, so another member's never appear here; a
 * member may connect more than one Notion workspace (each consent is its own
 * connection).
 */

import { and, eq, inArray } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { isConnectorConfigured } from "../config";
import { listConnectionsForOwner } from "../connection-store";
import { listDeletedItems, summarizeDeletedItems, type DeletedHereSummary } from "../deleted-items";
import { NOTION_PROVIDER, notionPauseReason, type NotionPauseReason } from "./config";
import { getSyncStates } from "./store";

export interface NotionConnectionStatus {
    readonly connectionId: string;
    readonly workspaceName: string | null;
    readonly status: string;
    readonly statusDetail: string | null;
    /** Where the pages are; null before the first sync, and for a folder the caller can't open. */
    readonly folderPath: string | null;
    readonly lastSyncAt: string | null;
    readonly lastSyncStatus: string | null;
    readonly lastSyncError: string | null;
    /** Set when the last run paused rather than failed; the card words it. */
    readonly paused: NotionPauseReason | null;
    readonly lastSyncReport: Record<string, unknown> | null;
    /** Pages deleted here, so not synced back; named only to whoever deleted them. */
    readonly deletedHere: DeletedHereSummary;
}

export interface NotionStatus {
    readonly configured: boolean;
    /** May the caller connect, sync and choose pages (`documents.upload`)? */
    readonly canConnect: boolean;
    readonly connections: readonly NotionConnectionStatus[];
}

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

export async function loadNotionStatus(ctx: WorkspaceContext): Promise<NotionStatus> {
    const configured = isConnectorConfigured(NOTION_PROVIDER);
    const canConnect = ctx.can("documents.upload");
    const connections = await listConnectionsForOwner(ctx.companyId, NOTION_PROVIDER, ctx.userPk);
    if (connections.length === 0) return { configured, canConnect, connections: [] };

    const [states, deletedRows] = await Promise.all([
        getSyncStates(connections.map(row => row.id)),
        listDeletedItems(connections.map(row => row.id)),
    ]);
    const folderIds = [...states.values()].flatMap(state =>
        state.folderCategoryId == null ? [] : [state.folderCategoryId]
    );
    const [paths, scope] = await Promise.all([
        folderPaths(ctx.companyId, folderIds),
        ctx.documentScope(),
    ]);

    return {
        configured,
        canConnect,
        connections: connections.map(row => {
            const state = states.get(row.id);
            const path =
                state?.folderCategoryId == null ? undefined : paths.get(state.folderCategoryId);
            return {
                connectionId: String(row.id),
                workspaceName: row.providerAccountEmail,
                status: row.status,
                statusDetail: row.lastRefreshError,
                // The folder starts private to the owner (ADR-014), who may
                // later move it somewhere they can no longer open.
                folderPath: path && scopeAllowsCategory(scope, path) ? path : null,
                lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: state?.lastSyncStatus ?? null,
                lastSyncError: state?.lastSyncError ?? null,
                paused:
                    state?.lastSyncStatus === "error"
                        ? notionPauseReason(state.lastSyncError)
                        : null,
                lastSyncReport: state?.lastSyncReport ?? null,
                deletedHere: summarizeDeletedItems(
                    deletedRows.filter(deleted => deleted.connectionId === row.id),
                    Number(ctx.userPk)
                ),
            };
        }),
    };
}
