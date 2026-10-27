/**
 * GET /api/documents/processing-queue's answer: every ingestion job whose
 * file the caller may see (ADR-014), active or finished in the last day,
 * with its six stages worked out, plus the connector syncs feeding the queue.
 *
 * Three lean reads for the jobs — the jobs joined to visible documents, their
 * stage rows, their outbox rows — and the stage logic runs in memory
 * (`~/lib/processing-queue/stages`). Whether a failed job may be retried is
 * read in bulk, only when something failed.
 */

import { and, eq } from "drizzle-orm";

import { DEFAULT_RETRY_POLICY } from "@launchstack/orchestration";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { connectorSyncSummary, type ConnectorSyncRow } from "~/lib/processing-queue/connectors";
import { buildQueueItem, summarize } from "~/lib/processing-queue/stages";
import type {
    ConnectorSyncSummary,
    ProcessingQueueItem,
    ProcessingQueueResponse,
} from "~/lib/processing-queue/types";
import { db } from "~/server/db";
import {
    connectorConnections,
    gmailSyncState,
    googleDriveSyncState,
} from "~/server/db/schema/connectors";
import { accessSubject, levelAtLeast } from "~/server/workspace/item-access";
import {
    classifyDocuments,
    loadDocumentAccessFacts,
    loadFolderAccessFacts,
} from "~/server/workspace/source-access";

import { selectEvents, selectQueueJobs, selectSteps, type QueueJobWithDocument } from "./rows";

/** Finished and failed jobs stay on the tab this long. */
export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The most jobs one answer carries. */
export const QUEUE_LIMIT = 200;

/** The actor slice the queue needs from a workspace context. */
export type QueueActor = Pick<
    WorkspaceContext,
    "authUserId" | "userPk" | "companyId" | "role" | "permissions" | "can" | "documentScope"
>;

/**
 * Which of these failed jobs the caller may retry: `documents.upload` plus
 * edit access to the file, by exactly the rules the write paths use
 * (`documentAccessFrom`), read once for the whole list.
 */
export async function retryableJobIds(
    actor: QueueActor,
    rows: readonly QueueJobWithDocument[]
): Promise<Set<string>> {
    const failed = rows.filter(r => r.job.status === "failed");
    if (failed.length === 0 || !actor.can("documents.upload")) return new Set();
    const [subject, folderFacts, documentFacts] = await Promise.all([
        accessSubject(actor),
        loadFolderAccessFacts(actor.companyId),
        loadDocumentAccessFacts(actor.companyId),
    ]);
    const access = classifyDocuments(
        failed.map(r => ({ id: r.document.id, category: r.document.category })),
        documentFacts,
        folderFacts,
        subject
    );
    const out = new Set<string>();
    for (const row of failed) {
        if (levelAtLeast(access.get(row.document.id)?.level ?? null, "edit")) out.add(row.job.id);
    }
    return out;
}

/** Build the items for these rows: one read for stage rows, one for outbox rows. */
export async function buildItems(
    actor: QueueActor,
    rows: readonly QueueJobWithDocument[],
    now: Date,
    retryable?: ReadonlySet<string>
): Promise<ProcessingQueueItem[]> {
    const jobIds = rows.map(r => r.job.id);
    const [steps, events, canRetry] = await Promise.all([
        selectSteps(jobIds),
        selectEvents(actor.companyId, jobIds),
        retryable ? Promise.resolve(retryable) : retryableJobIds(actor, rows),
    ]);
    return rows.map(row =>
        buildQueueItem({
            job: row.job,
            document: row.document,
            steps: steps.get(row.job.id) ?? [],
            events: events.get(row.job.id) ?? [],
            viewerUserId: actor.authUserId,
            canRetry: canRetry.has(row.job.id),
            maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
            now,
        })
    );
}

/**
 * Syncs the caller can see: their own Gmail (a mailbox is personal), and the
 * workspace's Drive connections for whoever manages connectors — the same
 * gates as GET /api/connectors/gmail and /api/connectors/google-drive/status.
 */
export async function listConnectorSyncs(
    actor: QueueActor,
    now: Date
): Promise<ConnectorSyncSummary[]> {
    const gmail = db
        .select({
            account: connectorConnections.providerAccountEmail,
            lastSyncStatus: gmailSyncState.lastSyncStatus,
            lastSyncAt: gmailSyncState.lastSyncAt,
            lastSyncError: gmailSyncState.lastSyncError,
            lastSyncReport: gmailSyncState.lastSyncReport,
            syncLockedAt: gmailSyncState.syncLockedAt,
        })
        .from(connectorConnections)
        .innerJoin(gmailSyncState, eq(gmailSyncState.connectionId, connectorConnections.id))
        .where(
            and(
                eq(connectorConnections.companyId, actor.companyId),
                eq(connectorConnections.provider, "gmail"),
                eq(connectorConnections.ownerUserId, actor.userPk)
            )
        );
    const drive = actor.can("connectors.manage")
        ? db
              .select({
                  account: connectorConnections.providerAccountEmail,
                  lastSyncStatus: googleDriveSyncState.lastSyncStatus,
                  lastSyncAt: googleDriveSyncState.lastSyncAt,
                  lastSyncError: googleDriveSyncState.lastSyncError,
                  lastSyncReport: googleDriveSyncState.lastSyncReport,
                  syncLockedAt: googleDriveSyncState.syncLockedAt,
              })
              .from(connectorConnections)
              .innerJoin(
                  googleDriveSyncState,
                  eq(googleDriveSyncState.connectionId, connectorConnections.id)
              )
              .where(
                  and(
                      eq(connectorConnections.companyId, actor.companyId),
                      eq(connectorConnections.provider, "google-drive")
                  )
              )
              .orderBy(connectorConnections.createdAt)
        : Promise.resolve([]);

    const [gmailRows, driveRows] = await Promise.all([gmail, drive]);
    const rows: ConnectorSyncRow[] = [
        ...driveRows.map(row => ({ ...row, provider: "google-drive" as const })),
        ...gmailRows.map(row => ({ ...row, provider: "gmail" as const })),
    ];
    return rows.flatMap(row => connectorSyncSummary(row, now) ?? []);
}

export async function listProcessingQueue(
    actor: QueueActor,
    now: Date = new Date()
): Promise<ProcessingQueueResponse> {
    const scope = await actor.documentScope();
    const [rows, connectors] = await Promise.all([
        selectQueueJobs(
            actor.companyId,
            scope,
            new Date(now.getTime() - FINISHED_WINDOW_MS),
            QUEUE_LIMIT
        ),
        listConnectorSyncs(actor, now),
    ]);
    const items = await buildItems(actor, rows, now);
    return {
        items,
        connectors,
        summary: summarize(items),
        serverTime: now.toISOString(),
    };
}
