/**
 * One end-to-end sync run for a connection: lease → token → client → connector
 * sync → bookkeeping. Runs inside the worker's Inngest function (and nowhere
 * else — ADR-003: apps/web hosts no durable work). The changes-feed cursor
 * only ever advances here, inside the lease.
 */

import {
    createDriveClient,
    syncGoogleDrive,
    type GoogleDriveSyncResult,
} from "@launchstack/pipelines/connectors/google-drive";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getConnectionAccessToken, getConnectionById } from "../connection-store";
import { ConnectorGrantRevokedError } from "../providers/types";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    listPickedItems,
    releaseSyncLease,
} from "./store";
import { createGoogleDriveSink, listKnownSourceIds, markMissingDocuments } from "./sink";

export type GoogleDriveSyncRunResult =
    | { readonly outcome: "synced"; readonly report: GoogleDriveSyncResult }
    | { readonly outcome: "clean"; readonly report: GoogleDriveSyncResult }
    | { readonly outcome: "skipped"; readonly reason: string };

function reportCounts(report: GoogleDriveSyncResult): Record<string, unknown> {
    return {
        dirty: report.dirty,
        discovered: report.discovered,
        stored: report.stored.length,
        skipped: report.skipped.length,
        unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
        failed: report.failed.length,
        missing: report.missingSourceIds.length,
        accessLost: report.accessLost.length,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

export async function runGoogleDriveSync(
    connectionId: bigint,
    options?: { readonly force?: boolean }
): Promise<GoogleDriveSyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== "google-drive") {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status} — reconnect` };
    }

    // Older connections (or a lost race on connect) may not have the state
    // row yet; the lease below needs one to claim.
    await ensureSyncState(connectionId);

    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    try {
        const accessToken = await getConnectionAccessToken(connection);
        const client = createDriveClient({ accessToken });

        // The sink attributes uploads to the granting user's Clerk identity.
        const [granter] = await db
            .select({ clerkUserId: users.userId })
            .from(users)
            .where(eq(users.id, connection.grantedByUserPk))
            .limit(1);
        if (!granter) {
            throw new Error("The user who connected Google Drive no longer exists");
        }

        const [syncState, pickedRows, knownSourceIds, sink] = await Promise.all([
            getSyncState(connectionId),
            listPickedItems(connectionId),
            listKnownSourceIds(connection.companyId, connectionId),
            createGoogleDriveSink({
                companyId: connection.companyId,
                connectionId,
                userId: granter.clerkUserId,
            }),
        ]);

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: pickedRows.map(row => ({
                fileId: row.fileId,
                kind: row.kind === "folder" ? "folder" : "file",
            })),
            startPageToken: syncState?.startPageToken ?? undefined,
            knownSourceIds,
            force: options?.force,
        });

        if (report.missingSourceIds.length > 0) {
            await markMissingDocuments(connection.companyId, connectionId, report.missingSourceIds);
        }

        await releaseSyncLease(connectionId, {
            status: "ok",
            startPageToken: report.nextStartPageToken,
            report: reportCounts(report),
        });

        return { outcome: report.dirty ? "synced" : "clean", report };
    } catch (error) {
        const message =
            error instanceof ConnectorGrantRevokedError
                ? "Google access was revoked — reconnect required"
                : error instanceof Error
                  ? error.message
                  : String(error);
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    }
}
