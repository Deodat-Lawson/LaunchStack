/**
 * One end-to-end Notion sync run for a connection: lease → token → client →
 * connector sync → bookkeeping. Runs inside the worker's Inngest function
 * (and nowhere else — ADR-003: apps/web hosts no durable work).
 *
 * Notion sends no token expiry, so the stored token is used until Notion
 * refuses it. A 401 gets exactly one refresh and one retry; a refresh that
 * comes back `invalid_grant` means the grant is gone, and the connection is
 * marked revoked so the panel offers reconnect instead of retrying forever.
 */

import {
    createNotionClient,
    NotionAuthError,
    syncNotion,
    type NotionSyncResult,
} from "@launchstack/pipelines/connectors/notion";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import type { OwnerRef } from "~/server/workspace/ownership";
import {
    getConnectionAccessToken,
    getConnectionById,
    markConnectionRevoked,
    refreshConnectionAccessToken,
} from "../connection-store";
import { ConnectorGrantRevokedError } from "../providers/types";
import { NOTION_PROVIDER } from "./config";
import { ensureNotionFolder } from "./folder";
import { createNotionSink, listKnownSourceIds, markMissingDocuments } from "./sink";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    releaseSyncLease,
    rememberFolder,
} from "./store";

export type NotionSyncRunResult =
    | { readonly outcome: "synced"; readonly report: NotionSyncResult }
    | { readonly outcome: "skipped"; readonly reason: string };

export function reportCounts(report: NotionSyncResult): Record<string, unknown> {
    return {
        discovered: report.discovered,
        stored: report.stored.length,
        revised: report.stored.filter(item => item.revised).length,
        skipped: report.skipped.length,
        unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
        tooLarge: report.skipped.filter(skip => skip.reason === "too-large").length,
        failed: report.failed.length,
        missing: report.missingSourceIds.length,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

export async function runNotionSync(
    connectionId: number,
    options?: { readonly force?: boolean }
): Promise<NotionSyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== NOTION_PROVIDER) {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status} — reconnect` };
    }

    await ensureSyncState(connectionId);
    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    try {
        // Pages are attributed to, and their folder owned by, whoever connected Notion.
        if (connection.grantedByUserId == null) {
            throw new Error(
                "The member who connected Notion left the workspace — reconnect required"
            );
        }
        const [granter] = await db
            .select({ authUserId: users.userId })
            .from(users)
            .where(eq(users.id, Number(connection.grantedByUserId)))
            .limit(1);
        if (!granter) throw new Error("The member who connected Notion no longer exists");
        const owner: OwnerRef = {
            companyId: connection.companyId,
            userPk: BigInt(connection.grantedByUserId),
            authUserId: granter.authUserId,
        };

        const state = await getSyncState(connectionId);
        const folder = await ensureNotionFolder({
            owner,
            workspaceName: connection.providerAccountEmail,
            rememberedCategoryId: state?.folderCategoryId ?? null,
        });
        if (folder.categoryId !== state?.folderCategoryId) {
            await rememberFolder(connectionId, folder.categoryId);
        }

        const [knownSourceIds, sink] = await Promise.all([
            listKnownSourceIds(connection.companyId, connectionId),
            createNotionSink({
                companyId: connection.companyId,
                connectionId,
                userId: granter.authUserId,
                category: folder.path,
            }),
        ]);

        const run = (accessToken: string) =>
            syncNotion({
                client: createNotionClient({ accessToken }),
                sink,
                knownSourceIds,
                force: options?.force,
                workspaceName: connection.providerAccountEmail,
            });

        let report: NotionSyncResult;
        try {
            report = await run(await getConnectionAccessToken(connection));
        } catch (error) {
            if (!(error instanceof NotionAuthError)) throw error;
            report = await run(await refreshConnectionAccessToken(connectionId));
        }

        if (report.missingSourceIds.length > 0) {
            await markMissingDocuments(connection.companyId, connectionId, report.missingSourceIds);
        }

        await releaseSyncLease(connectionId, { status: "ok", report: reportCounts(report) });
        return { outcome: "synced", report };
    } catch (error) {
        const revoked =
            error instanceof ConnectorGrantRevokedError || error instanceof NotionAuthError;
        const message = revoked
            ? "Notion access was revoked — reconnect required"
            : error instanceof Error
              ? error.message
              : "Notion sync failed";
        // A refreshed token that Notion still refuses is a dead grant; the
        // refresh path already flipped the row for an invalid_grant.
        if (error instanceof NotionAuthError) await markConnectionRevoked(connectionId, message);
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    }
}
