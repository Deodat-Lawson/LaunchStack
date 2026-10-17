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

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { userCompanyMemberships, users } from "~/server/db/schema";
import { driveApiBaseUrl, grantsFolderAccess } from "~/server/services/google-drive/config";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
import type { OwnerRef } from "~/server/workspace/ownership";
import { getConnectionById } from "../connection-store";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    listPickedItems,
    releaseSyncLease,
    resetSyncCursor,
} from "./store";
import { ensureCategoryRow } from "../../folder-access";
import {
    createDriveDestinations,
    missingToMark,
    ownerForPick,
    type PickedRoot,
} from "./destinations";
import {
    GOOGLE_DRIVE_CATEGORY,
    createGoogleDriveSink,
    listKnownSources,
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
        // Ids, not a count: the panel names the folders it couldn't read.
        emptyFolders: report.emptyFolders,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

/**
 * The people who picked items, as ADR-014 owners. Someone no longer an
 * active member is absent: files the sync adds to their folder then take
 * the folder's audience (handed over when they were removed) and no grant.
 */
async function ownersByUserPk(
    companyId: bigint,
    userPks: readonly (number | null)[]
): Promise<Map<number, OwnerRef>> {
    const wanted = [...new Set(userPks.filter((pk): pk is number => pk != null))];
    if (wanted.length === 0) return new Map();
    const rows = await db
        .select({ id: users.id, authUserId: users.userId })
        .from(users)
        .innerJoin(
            userCompanyMemberships,
            and(
                eq(userCompanyMemberships.userId, sql`${users.id}`),
                eq(userCompanyMemberships.companyId, companyId),
                eq(userCompanyMemberships.status, "active")
            )
        )
        .where(inArray(users.id, wanted));
    return new Map(
        rows.map(row => [
            Number(row.id),
            { companyId, userPk: BigInt(row.id), authUserId: row.authUserId },
        ])
    );
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
        const client = createDriveClient({ accessToken, baseUrl: driveApiBaseUrl() });

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

        const [syncState, pickedRows, knownSources] = await Promise.all([
            getSyncState(connectionId),
            listPickedItems(connectionId),
            listKnownSources(connection.companyId, connectionId),
        ]);

        // A picked folder belongs to whoever picked it (ADR-014); files
        // picked one by one stay a workspace import, as before.
        const pickers = await ownersByUserPk(
            connection.companyId,
            pickedRows.map(row => row.addedByUserPk)
        );
        // Whoever connected Drive stands in for a picker who has since left.
        const granterOwner: OwnerRef = {
            companyId: connection.companyId,
            userPk: BigInt(connection.grantedByUserId),
            authUserId: granter.authUserId,
        };
        const roots: PickedRoot[] = pickedRows.map(row => ({
            id: row.id,
            fileId: row.fileId,
            kind: row.kind,
            name: row.name,
            folderCategoryId: row.folderCategoryId,
            owner: ownerForPick(row.addedByUserPk, pickers, granterOwner),
        }));
        const destinations = createDriveDestinations({
            companyId: connection.companyId,
            connectionId,
            roots,
        });
        const sink = await createGoogleDriveSink({
            companyId: connection.companyId,
            connectionId,
            userId: granter.authUserId,
            place: item => destinations.placeFor(item),
        });

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: pickedRows.map(row => ({
                fileId: row.fileId,
                kind: row.kind === "folder" ? "folder" : "file",
            })),
            startPageToken: syncState?.startPageToken ?? undefined,
            knownSourceIds: knownSources.map(known => known.sourceId),
            force: options?.force,
        });

        // Under drive.file an imported folder lists empty: its files are
        // unseen, not removed from Drive, so they keep their documents
        // unflagged until folder access shows what is really there.
        const missing = missingToMark(
            report.missingSourceIds,
            knownSources,
            grantsFolderAccess(connection.scopes) ? [] : report.emptyFolders
        );
        if (missing.length > 0) {
            await markMissingDocuments(connection.companyId, connectionId, missing);
        }

        await releaseSyncLease(connectionId, {
            status: "ok",
            startPageToken: report.nextStartPageToken,
            report: reportCounts(report),
        });
        // A picked folder that listed empty is usually one the grant can't
        // read yet. Nothing in Drive changes when access is granted, so a
        // cursor would call every later run clean; walk it again instead
        // (one listing per empty folder per run).
        if (report.emptyFolders.length > 0) await resetSyncCursor(connectionId);

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
