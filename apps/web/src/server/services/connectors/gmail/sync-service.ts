/**
 * One end-to-end Gmail sync run for a connection: lease → token → client →
 * connector sync → bookkeeping. Runs inside the worker's Inngest function
 * (and nowhere else — ADR-003: apps/web hosts no durable work). The history
 * cursor only ever advances here, inside the lease.
 */

import {
    createGmailClient,
    GmailAuthError,
    syncGmail,
    type GmailSyncResult,
} from "@launchstack/pipelines/connectors/gmail";
import { GoogleAuthError } from "@launchstack/google-drive";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { markConnectionRevoked } from "~/server/services/google-drive/connections";
import { getConnectionById } from "../connection-store";
import { GMAIL_PROVIDER } from "./config";
import { getGmailAccessToken } from "./connections";
import { ensurePrivateGmailFolder } from "./folder";
import { createGmailSink, listKnownSourceIds, markMissingDocuments } from "./sink";
import {
    claimSyncLease,
    ensureSyncState,
    getSyncState,
    listScope,
    releaseSyncLease,
} from "./store";

export type GmailSyncRunResult =
    | { readonly outcome: "synced"; readonly report: GmailSyncResult }
    | { readonly outcome: "clean"; readonly report: GmailSyncResult }
    | { readonly outcome: "skipped"; readonly reason: string };

export function reportCounts(report: GmailSyncResult): Record<string, unknown> {
    return {
        dirty: report.dirty,
        discovered: report.discovered,
        stored: report.stored.length,
        threads: report.stored.filter(item => !item.sourceId.includes(":")).length,
        attachments: report.stored.filter(item => item.sourceId.includes(":")).length,
        skipped: report.skipped.length,
        unchanged: report.skipped.filter(skip => skip.reason === "unchanged").length,
        failed: report.failed.length,
        missing: report.missingSourceIds.length,
        notFound: report.notFound.length,
        changedThreads: report.changedThreads,
        historyExpired: report.historyExpired,
        truncated: report.truncated,
        durationMs: report.durationMs,
    };
}

export async function runGmailSync(
    connectionId: number,
    options?: { readonly force?: boolean }
): Promise<GmailSyncRunResult> {
    const connection = await getConnectionById(connectionId);
    if (!connection || connection.provider !== GMAIL_PROVIDER) {
        return { outcome: "skipped", reason: "connection not found" };
    }
    if (connection.status !== "active") {
        return { outcome: "skipped", reason: `connection is ${connection.status} — reconnect` };
    }
    if (connection.ownerUserId == null) {
        return { outcome: "skipped", reason: "gmail connection has no owner" };
    }

    await ensureSyncState(connectionId);
    if (!(await claimSyncLease(connectionId))) {
        return { outcome: "skipped", reason: "another sync holds the lease" };
    }

    try {
        const [owner] = await db
            .select({ authUserId: users.userId, email: users.email })
            .from(users)
            .where(eq(users.id, Number(connection.ownerUserId)))
            .limit(1);
        if (!owner) throw new Error("The member who connected Gmail no longer exists");

        const selectors = await listScope(connectionId);
        if (selectors.length === 0) {
            await releaseSyncLease(connectionId, {
                status: "ok",
                report: { discovered: 0, stored: 0, skipped: 0, failed: 0, noScope: true },
            });
            return { outcome: "skipped", reason: "no labels or searches selected" };
        }

        const accessToken = await getGmailAccessToken(connection);
        const client = createGmailClient({ accessToken });

        // The folder is re-asserted every run so it stays restricted to the owner.
        const folder = await ensurePrivateGmailFolder({
            companyId: connection.companyId,
            ownerUserPk: connection.ownerUserId,
            ownerAuthUserId: owner.authUserId,
            accountEmail: connection.providerAccountEmail ?? owner.email,
        });

        const [syncState, knownSourceIds, sink] = await Promise.all([
            getSyncState(connectionId),
            listKnownSourceIds(connection.companyId, connectionId),
            createGmailSink({
                companyId: connection.companyId,
                connectionId,
                userId: owner.authUserId,
                category: folder.path,
            }),
        ]);

        const report = await syncGmail({
            client,
            sink,
            selectors: selectors.map(row => ({
                kind: row.kind === "query" ? "query" : "label",
                value: row.value,
                name: row.name,
            })),
            historyId: syncState?.historyId ?? undefined,
            knownSourceIds,
            force: options?.force,
        });

        if (report.missingSourceIds.length > 0) {
            await markMissingDocuments(connection.companyId, connectionId, report.missingSourceIds);
        }

        await releaseSyncLease(connectionId, {
            status: "ok",
            historyId: report.nextHistoryId,
            report: reportCounts(report),
        });

        return { outcome: report.dirty ? "synced" : "clean", report };
    } catch (error) {
        const revoked =
            (error instanceof GoogleAuthError && error.invalidGrant) ||
            error instanceof GmailAuthError;
        const message = revoked
            ? "Gmail access was revoked or is missing the mail scope — reconnect required"
            : error instanceof Error
              ? error.message
              : String(error);
        if (error instanceof GmailAuthError) {
            // A fresh token that Gmail refuses means the grant lost its scope;
            // flip the row so the UI offers reconnect instead of retrying forever.
            await markConnectionRevoked(connectionId, message);
        }
        await releaseSyncLease(connectionId, { status: "error", error: message });
        throw error;
    }
}
