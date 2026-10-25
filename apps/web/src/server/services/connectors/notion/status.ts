/**
 * What the Notion panel shows: every Notion workspace connected here, where
 * its pages land, and how its last sync went. A workspace may connect more
 * than one Notion workspace (each consent is its own connection).
 */

import { and, eq, inArray } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { scopeAllowsCategory } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { isConnectorConfigured } from "../config";
import { listConnectionsForCompany } from "../connection-store";
import { NOTION_PROVIDER } from "./config";
import { getSyncStates } from "./store";

export interface NotionConnectionStatus {
    readonly connectionId: string;
    readonly workspaceName: string | null;
    readonly status: string;
    readonly statusDetail: string | null;
    readonly connectedBy: string | null;
    /** Where the pages are; null before the first sync, and for a folder the caller can't open. */
    readonly folderPath: string | null;
    readonly lastSyncAt: string | null;
    readonly lastSyncStatus: string | null;
    readonly lastSyncError: string | null;
    readonly lastSyncReport: Record<string, unknown> | null;
}

export interface NotionStatus {
    readonly configured: boolean;
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

async function memberNames(ids: readonly bigint[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ids.map(Number)));
    return new Map(rows.flatMap(row => (row.name ? [[String(row.id), row.name] as const] : [])));
}

export async function loadNotionStatus(ctx: WorkspaceContext): Promise<NotionStatus> {
    const configured = isConnectorConfigured(NOTION_PROVIDER);
    const connections = await listConnectionsForCompany(ctx.companyId, NOTION_PROVIDER);
    if (connections.length === 0) return { configured, connections: [] };

    const states = await getSyncStates(connections.map(row => row.id));
    const folderIds = [...states.values()].flatMap(state =>
        state.folderCategoryId == null ? [] : [state.folderCategoryId]
    );
    const [paths, names, scope] = await Promise.all([
        folderPaths(ctx.companyId, folderIds),
        memberNames(
            connections.flatMap(row => (row.grantedByUserId == null ? [] : [row.grantedByUserId]))
        ),
        ctx.documentScope(),
    ]);

    return {
        configured,
        connections: connections.map(row => {
            const state = states.get(row.id);
            const path =
                state?.folderCategoryId == null ? undefined : paths.get(state.folderCategoryId);
            return {
                connectionId: String(row.id),
                workspaceName: row.providerAccountEmail,
                status: row.status,
                statusDetail: row.lastRefreshError,
                connectedBy:
                    row.grantedByUserId == null
                        ? null
                        : (names.get(String(row.grantedByUserId)) ?? null),
                // The folder is private to whoever connected Notion (ADR-014);
                // another admin learns that pages synced, not where they are.
                folderPath: path && scopeAllowsCategory(scope, path) ? path : null,
                lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
                lastSyncStatus: state?.lastSyncStatus ?? null,
                lastSyncError: state?.lastSyncError ?? null,
                lastSyncReport: state?.lastSyncReport ?? null,
            };
        }),
    };
}
