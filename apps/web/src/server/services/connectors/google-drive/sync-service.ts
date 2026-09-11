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
import { GoogleAuthError } from "@launchstack/google-drive";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
import { getConnectionById } from "../connection-store";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    listPickedItems,
    releaseSyncLease,
} from "./store";
import { ensureCategoryRow } from "../../folder-access";
import {
    GOOGLE_DRIVE_CATEGORY,
    createGoogleDriveSink,
    listKnownSourceIds,
    markMissingDocuments,
} from "./sink";

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
    connectionId: number,
    options?: { readonly force?: boolean }
): Promise<GoogleDriveSyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== "google-drive") {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status} — reconnect` };
    }

    // A fresh connection has no state row yet (the first full sync also
    // needs no cursor); the lease below needs one to claim.
    await ensureSyncState(connectionId);

    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    try {
        const accessToken = await getAccessTokenForConnection(connection);
        const client = createDriveClient({ accessToken });

        // The sink attributes uploads to the granting user's auth identity.
        if (connection.grantedByUserId == null) {
            throw new Error(
                "The user who connected Google Drive left the workspace — reconnect required"
            );
        }
        const [granter] = await db
            .select({ authUserId: users.userId })
            .from(users)
            .where(eq(users.id, Number(connection.grantedByUserId)))
            .limit(1);
        if (!granter) {
            throw new Error("The user who connected Google Drive no longer exists");
        }

        // The folder the sink writes into must exist as a category row so it
        // can be restricted like any other folder.
        await ensureCategoryRow(connection.companyId, GOOGLE_DRIVE_CATEGORY);

        const [syncState, pickedRows, knownSourceIds, sink] = await Promise.all([
            getSyncState(connectionId),
            listPickedItems(connectionId),
            listKnownSourceIds(connection.companyId, connectionId),
            createGoogleDriveSink({
                companyId: connection.companyId,
                connectionId,
                userId: granter.authUserId,
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
            error instanceof GoogleAuthError && error.invalidGrant
                ? "Google access was revoked — reconnect required"
                : error instanceof Error
                  ? error.message
                  : String(error);
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    }
}
