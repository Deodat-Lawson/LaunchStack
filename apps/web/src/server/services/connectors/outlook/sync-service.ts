/**
 * One end-to-end Outlook sync run for a connection: standing, lease, scope,
 * token, folder, connector sync, bookkeeping. Runs inside the worker's
 * Inngest function and nowhere else (ADR-003: apps/web hosts no durable
 * work). The delta links only ever advance here, inside the lease, and only
 * when the run succeeded.
 */

import {
    createOutlookClient,
    OutlookAuthError,
    syncOutlook,
    type OutlookSyncResult,
} from "@launchstack/pipelines/connectors/outlook";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { graphApiBaseUrl, OUTLOOK_PROVIDER } from "~/server/services/microsoft/config";
import {
    getMicrosoftAccessToken,
    markMicrosoftConnectionRevoked,
} from "~/server/services/microsoft/connections";
import { MicrosoftAuthError } from "~/server/services/microsoft/oauth";
import { getConnectionById } from "../connection-store";
import {
    closePersonalConnectionsNow,
    personalSyncStanding,
    sweepMailboxOfClosedConnection,
} from "../personal-connections";
import { ensurePrivateOutlookFolder } from "./folder";
import { createOutlookSink, listKnownSourceIds, markMissingDocuments } from "./sink";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    listScope,
    releaseSyncLease,
} from "./store";

export type OutlookSyncRunResult =
    | { readonly outcome: "synced"; readonly report: OutlookSyncResult }
    | { readonly outcome: "clean"; readonly report: OutlookSyncResult }
    | { readonly outcome: "skipped"; readonly reason: string };

export function reportCounts(report: OutlookSyncResult): Record<string, unknown> {
    return {
        dirty: report.dirty,
        discovered: report.discovered,
        stored: report.stored.length,
        conversations: report.stored.filter(item => !item.sourceId.includes(":")).length,
        attachments: report.stored.filter(item => item.sourceId.includes(":")).length,
        skipped: report.skipped.length,
        unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
        failed: report.failed.length,
        missing: report.missingSourceIds.length,
        notFound: report.notFound.length,
        changedConversations: report.changedConversations,
        removedMessages: report.removedMessages,
        deltaExpired: report.deltaExpired,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

export async function runOutlookSync(
    connectionId: number,
    options?: { readonly force?: boolean }
): Promise<OutlookSyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== OUTLOOK_PROVIDER) {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status}: reconnect` };
    }
    if (connection.ownerUserId == null) {
        return { outcome: "skipped", reason: "outlook connection has no owner" };
    }

    // A mailbox syncs only for an active member who may add files. One whose
    // owner has left is closed now, mail and all, exactly as removal would.
    const standing = await personalSyncStanding(connection.companyId, connection.ownerUserId);
    if (standing === "departed") {
        await closePersonalConnectionsNow(connection.companyId, connection.ownerUserId);
        return { outcome: "skipped", reason: "owner left the workspace: connection closed" };
    }
    if (standing === "paused") {
        return {
            outcome: "skipped",
            reason: "owner is suspended or can no longer add files: paused",
        };
    }

    await ensureSyncState(connectionId);
    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    // Set once this run has (re)made the mailbox folder: from then on it may
    // have written there, and the sweep below needs to know where.
    let mailbox: string | null = null;
    try {
        const [owner] = await db
            .select({ authUserId: users.userId, email: users.email })
            .from(users)
            .where(eq(users.id, Number(connection.ownerUserId)))
            .limit(1);
        if (!owner) throw new Error("The member who connected Outlook no longer exists");

        const selectors = await listScope(connectionId);
        if (selectors.length === 0) {
            await releaseSyncLease(connectionId, {
                status: "ok",
                report: { discovered: 0, stored: 0, skipped: 0, failed: 0, noScope: true },
            });
            return { outcome: "skipped", reason: "no mail folders or searches selected" };
        }

        const accessToken = await getMicrosoftAccessToken(connection);
        const client = createOutlookClient({ accessToken, baseUrl: graphApiBaseUrl() });

        // The folder is re-asserted every run so it stays restricted to the owner.
        const folder = await ensurePrivateOutlookFolder({
            companyId: connection.companyId,
            ownerUserPk: connection.ownerUserId,
            ownerAuthUserId: owner.authUserId,
            accountEmail: connection.providerAccountEmail ?? owner.email,
        });
        mailbox = folder.path;

        const [syncState, knownSourceIds, sink] = await Promise.all([
            getSyncState(connectionId),
            listKnownSourceIds(connection.companyId, connectionId),
            createOutlookSink({
                companyId: connection.companyId,
                connectionId,
                userId: owner.authUserId,
                category: folder.path,
            }),
        ]);

        const scope = selectors.map(row => ({
            kind: row.kind === "query" ? ("query" as const) : ("folder" as const),
            value: row.value,
            name: row.name,
        }));
        const report = await syncOutlook({
            client,
            sink,
            selectors: scope,
            deltaLinks: syncState?.deltaLinks ?? undefined,
            knownSourceIds,
            force: options?.force,
        });

        // Flagged, never deleted: what a full walk no longer found, and what
        // answered "not found" when this run went to read it.
        const gone = new Set([...report.missingSourceIds, ...report.notFound]);
        let nextDeltaLinks = report.nextDeltaLinks;

        // A delta feed says a message was deleted or moved away, not which
        // conversation it belonged to, so an incremental run cannot say what
        // is gone. When one reports removals, the chosen folders are walked
        // whole once more, inside the same lease, and that walk can. It
        // starts without delta links rather than with `force`: unchanged
        // conversations are still recognised and skipped, so nothing is
        // stored twice.
        let recheck: OutlookSyncResult | null = null;
        if (report.changedConversations !== null && report.removedMessages > 0) {
            recheck = await syncOutlook({
                client,
                sink,
                selectors: scope,
                knownSourceIds: await listKnownSourceIds(connection.companyId, connectionId),
            });
            for (const id of [...recheck.missingSourceIds, ...recheck.notFound]) gone.add(id);
            nextDeltaLinks = recheck.nextDeltaLinks;
        }

        if (gone.size > 0) {
            await markMissingDocuments(connection.companyId, connectionId, [...gone]);
        }

        // The new links replace the stored map whole, and only now that the
        // run has succeeded: a failed run must see its changes again.
        await releaseSyncLease(connectionId, {
            status: "ok",
            deltaLinks: { ...nextDeltaLinks },
            report: {
                ...reportCounts(report),
                ...(recheck
                    ? {
                          missing: gone.size,
                          failed: report.failed.length + recheck.failed.length,
                          recheckedAfterRemovals: true,
                      }
                    : {}),
            },
        });

        return { outcome: report.dirty ? "synced" : "clean", report };
    } catch (error) {
        // The refresh token was refused (`getMicrosoftAccessToken` has already
        // flipped the row), or a fresh token was refused by Graph: the grant
        // is gone or lost Mail.Read.
        const refreshRefused = error instanceof MicrosoftAuthError && error.invalidGrant;
        const graphRefused = error instanceof OutlookAuthError;
        const message =
            refreshRefused || graphRefused
                ? "Outlook access was revoked or no longer includes reading mail. Reconnect to resume."
                : error instanceof Error
                  ? error.message
                  : String(error);
        if (graphRefused) {
            // Flip the row so the panel offers reconnect instead of retrying forever.
            await markMicrosoftConnectionRevoked(connectionId, message);
        }
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    } finally {
        // The owner may have been removed while this run was going: the
        // removal cleared the mailbox, and this run may have written to it
        // since. If the connection is gone, what is there now goes too.
        if (mailbox) {
            try {
                await sweepMailboxOfClosedConnection(connection.companyId, connectionId, mailbox);
            } catch (sweepError) {
                console.error(
                    "[outlook] sweeping a closed connection's mailbox failed:",
                    sweepError
                );
            }
        }
    }
}
