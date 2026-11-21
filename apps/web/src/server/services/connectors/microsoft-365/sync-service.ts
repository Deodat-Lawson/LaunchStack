/**
 * One end-to-end sync run for a Microsoft 365 connection: lease, token,
 * client, connector sync, bookkeeping. Runs inside the worker's Inngest
 * function and nowhere else (ADR-003: apps/web hosts no durable work).
 *
 * There is no change cursor. Every run walks what was picked and compares
 * each file's fingerprint from the listing with the one stored, so an
 * unchanged file costs a listing entry and never a download.
 */

import {
    createMicrosoft365Client,
    microsoft365SourceId,
    Microsoft365AuthError,
    syncMicrosoft365,
    type Microsoft365SyncResult,
} from "@launchstack/pipelines/connectors/microsoft-365";
import { DELETED_HERE_DETAIL } from "@launchstack/pipelines/connectors";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { userCompanyMemberships, users } from "~/server/db/schema";
import { graphApiBaseUrl, MICROSOFT_365_PROVIDER } from "~/server/services/microsoft/config";
import {
    getMicrosoftAccessToken,
    markMicrosoftConnectionRevoked,
} from "~/server/services/microsoft/connections";
import { MicrosoftAuthError } from "~/server/services/microsoft/oauth";
import type { OwnerRef } from "~/server/workspace/ownership";
import { getConnectionById } from "../connection-store";
import { ensureCategoryRow } from "../../folder-access";
import { listDeletedSourceIds } from "../deleted-items";
import {
    createMicrosoft365Destinations,
    missingToMark,
    ownerForPick,
    type PickedRoot,
} from "./destinations";
import {
    MICROSOFT_365_CATEGORY,
    createMicrosoft365Sink,
    listKnownSources,
    markMissingDocuments,
} from "./sink";
import { claimSyncLease, ensureSyncState, listPickedItems, releaseSyncLease } from "./store";

export type Microsoft365SyncRunResult =
    | { readonly outcome: "synced"; readonly report: Microsoft365SyncResult }
    | { readonly outcome: "clean"; readonly report: Microsoft365SyncResult }
    | { readonly outcome: "skipped"; readonly reason: string };

/** What the status route and Settings read back as the last run. */
export function reportCounts(report: Microsoft365SyncResult): Record<string, unknown> {
    return {
        dirty: report.dirty,
        discovered: report.discovered,
        stored: report.stored.length,
        skipped: report.skipped.length,
        unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
        deletedHere: report.skipped.filter(skip => skip.detail === DELETED_HERE_DETAIL).length,
        failed: report.failed.length,
        missing: report.missingSourceIds.length,
        accessLost: report.accessLost.length,
        // Source ids, not a count: the panel names the folders that came back empty.
        emptyFolders: report.emptyFolders,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

/**
 * The connector reports a folder it could not read as a skipped item rather
 * than throwing, a dead token included. A run where Graph answered 401 is a
 * connection to reconnect, not a list of unreadable folders.
 */
export function tokenRejected(report: Pick<Microsoft365SyncResult, "skipped">): boolean {
    return report.skipped.some(
        skip => typeof skip.detail === "string" && skip.detail.startsWith("Microsoft365AuthError")
    );
}

const REVOKED_MESSAGE = "Microsoft access was revoked. Reconnect to keep syncing.";

/**
 * The people who picked items, as ADR-014 owners. Someone no longer an
 * active member is absent: whoever connected the account stands in.
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

export async function runMicrosoft365Sync(
    connectionId: number,
    options?: { readonly force?: boolean }
): Promise<Microsoft365SyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== MICROSOFT_365_PROVIDER) {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status}: reconnect` };
    }

    // A connection made before its state row existed still needs one to claim.
    await ensureSyncState(connectionId);

    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    try {
        const accessToken = await getMicrosoftAccessToken(connection);
        const client = createMicrosoft365Client({ accessToken, baseUrl: graphApiBaseUrl() });

        // The sink attributes uploads to the granting user's auth identity.
        if (connection.grantedByUserId == null) {
            throw new Error(
                "The user who connected Microsoft 365 left the workspace. Reconnect required."
            );
        }
        const [granter] = await db
            .select({ authUserId: users.userId })
            .from(users)
            .where(eq(users.id, Number(connection.grantedByUserId)))
            .limit(1);
        if (!granter) {
            throw new Error("The user who connected Microsoft 365 no longer exists");
        }

        // The folder a pick without a destination writes into must exist as a
        // category row so it can be restricted like any other folder.
        await ensureCategoryRow(connection.companyId, MICROSOFT_365_CATEGORY);

        const [pickedRows, knownSources, deletedSourceIds] = await Promise.all([
            listPickedItems(connectionId),
            listKnownSources(connection.companyId, connectionId),
            listDeletedSourceIds(connectionId),
        ]);

        // What a pick brings in belongs to whoever picked it (ADR-014);
        // whoever connected the account stands in for a picker who has left.
        const pickers = await ownersByUserPk(
            connection.companyId,
            pickedRows.map(row => row.addedByUserPk)
        );
        const granterOwner: OwnerRef = {
            companyId: connection.companyId,
            userPk: BigInt(connection.grantedByUserId),
            authUserId: granter.authUserId,
        };
        const roots: PickedRoot[] = pickedRows.map(row => ({
            id: row.id,
            sourceId: microsoft365SourceId(row.driveId, row.itemId),
            kind: row.kind,
            name: row.name,
            folderCategoryId: row.folderCategoryId,
            destination: row.destination,
            owner: ownerForPick(row.addedByUserPk, pickers, granterOwner),
        }));
        const destinations = createMicrosoft365Destinations({
            companyId: connection.companyId,
            connectionId,
            roots,
        });
        const sink = await createMicrosoft365Sink({
            companyId: connection.companyId,
            connectionId,
            userId: granter.authUserId,
            place: item => destinations.placeFor(item),
        });

        const report = await syncMicrosoft365({
            client,
            sink,
            pickedItems: pickedRows.map(row => ({
                driveId: row.driveId,
                itemId: row.itemId,
                kind: row.kind === "folder" ? "folder" : "file",
            })),
            knownSourceIds: knownSources.map(known => known.sourceId),
            deletedSourceIds,
            force: options?.force,
        });

        if (tokenRejected(report)) {
            throw new Microsoft365AuthError("Microsoft Graph rejected the access token");
        }

        // The connector reports nothing missing when a walk was cut short,
        // so every id here is a file the picks no longer reach.
        const missing = missingToMark(report.missingSourceIds, knownSources, []);
        if (missing.length > 0) {
            await markMissingDocuments(connection.companyId, connectionId, missing);
        }

        await releaseSyncLease(connectionId, { status: "ok", report: reportCounts(report) });

        return { outcome: report.dirty ? "synced" : "clean", report };
    } catch (error) {
        // A refresh that fails with invalid_grant has already flipped the
        // connection; a 401 from Graph itself has not.
        const revoked =
            error instanceof Microsoft365AuthError ||
            (error instanceof MicrosoftAuthError && error.invalidGrant);
        if (error instanceof Microsoft365AuthError) {
            await markMicrosoftConnectionRevoked(connectionId, error.message);
        }
        const message = revoked
            ? REVOKED_MESSAGE
            : error instanceof Error
              ? error.message
              : String(error);
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    }
}
