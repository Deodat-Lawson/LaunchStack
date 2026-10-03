/**
 * One Gmail sync run: history dirty-check → discover → fingerprint-compare →
 * collect → store. The cost is proportional to what changed:
 *
 * - An idle mailbox costs two calls (profile + an empty history page).
 * - A mailbox with changes lists the selectors (cheap) and touches only the
 *   threads the history feed named, plus any newly matched ones.
 * - A known thread whose message set is unchanged is confirmed with a
 *   `format=minimal` fetch — no bodies — and skipped.
 * - The first run, a forced run, or an expired history cursor walks
 *   everything the selectors match.
 *
 * The connector never touches the database: the host's `KnowledgeSink` owns
 * storage and `knownSourceIds` (what the host already ingested) is how
 * deletions are noticed.
 */

import type {
    FailedKnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import {
    GmailHistoryExpiredError,
    GmailNotFoundError,
    type GmailClient,
    type GmailHistoryRecord,
} from "./client";
import {
    attachmentFingerprint,
    collectGmailAttachment,
    collectGmailThread,
    DEFAULT_MAX_ITEM_BYTES,
    threadIdOfSourceId,
    toAttachmentDiscoveredItem,
    toThreadDiscoveredItem,
    type AttachmentPolicy,
} from "./collect";
import {
    describeError,
    discoverGmailThreads,
    GMAIL_CONNECTOR_ID,
    type GmailDiscoveredThread,
    type GmailScopeSelector,
} from "./discover";
import { threadFingerprint, threadMessages } from "./render";

export const DEFAULT_SYNC_CONCURRENCY = 4;

export interface GmailSyncOptions {
    readonly client: GmailClient;
    readonly selectors: readonly GmailScopeSelector[];
    readonly sink: KnowledgeSink;
    /** Mailbox history cursor from the previous run; absent on the first run. */
    readonly historyId?: string;
    /** Source ids the host has already ingested; absent ones are reported missing on full runs. */
    readonly knownSourceIds?: readonly string[];
    readonly force?: boolean;
    readonly includeAttachments?: boolean;
    readonly attachmentPolicy?: AttachmentPolicy;
    readonly maxItemBytes?: number;
    readonly maxThreads?: number;
    /** Parallel collect+store pipelines. Defaults to 4. */
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface GmailSyncResult extends KnowledgeSyncReport {
    /** False → the history feed was empty and nothing else ran. */
    readonly dirty: boolean;
    /** Persist after a successful run; next run's dirty-check starts here. */
    readonly nextHistoryId: string | null;
    /** The stored cursor was too old; this run walked everything. */
    readonly historyExpired: boolean;
    /** Full runs only: previously-ingested source ids the selectors no longer match. */
    readonly missingSourceIds: readonly string[];
    /** Threads answering 404 mid-run — deleted since discovery. */
    readonly notFound: readonly string[];
    readonly truncated: boolean;
    /** Threads the history feed named; null on a full run. */
    readonly changedThreads: number | null;
    readonly accountEmail: string | null;
}

async function runWithConcurrency<T>(
    tasks: readonly (() => Promise<T>)[],
    limit: number
): Promise<T[]> {
    const results = new Array<T>(tasks.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
        while (true) {
            const index = cursor++;
            const task = tasks[index];
            if (!task) return;
            results[index] = await task();
        }
    });

    await Promise.all(workers);
    return results;
}

function threadIdsIn(record: GmailHistoryRecord): string[] {
    const ids: string[] = [];
    for (const ref of record.messages ?? []) ids.push(ref.threadId);
    for (const entry of record.messagesAdded ?? []) ids.push(entry.message.threadId);
    for (const entry of record.messagesDeleted ?? []) ids.push(entry.message.threadId);
    for (const entry of record.labelsAdded ?? []) ids.push(entry.message.threadId);
    for (const entry of record.labelsRemoved ?? []) ids.push(entry.message.threadId);
    return ids;
}

/**
 * Thread ids the mailbox history mentions since the cursor, or null when the
 * cursor has expired and the caller must walk everything.
 */
async function changedThreadsSince(
    client: GmailClient,
    startHistoryId: string
): Promise<Set<string> | null> {
    const changed = new Set<string>();
    let pageToken: string | undefined;
    try {
        do {
            const page = await client.listHistory({ startHistoryId, pageToken });
            for (const record of page.history ?? []) {
                for (const threadId of threadIdsIn(record)) changed.add(threadId);
            }
            pageToken = page.nextPageToken;
        } while (pageToken);
    } catch (error) {
        if (error instanceof GmailHistoryExpiredError) return null;
        throw error;
    }
    return changed;
}

type ThreadOutcome = {
    readonly stored: StoredKnowledgeItem[];
    readonly skipped: SkippedKnowledgeItem[];
    readonly failed: FailedKnowledgeItem[];
    readonly notFound: string[];
};

interface ProcessContext {
    readonly client: GmailClient;
    readonly sink: KnowledgeSink;
    readonly force: boolean;
    readonly known: ReadonlySet<string>;
    readonly labelNames: ReadonlyMap<string, string>;
    readonly accountEmail: string | null;
    readonly maxItemBytes: number;
    readonly includeAttachments: boolean;
    readonly attachmentPolicy: AttachmentPolicy;
}

async function processThread(
    context: ProcessContext,
    discovered: GmailDiscoveredThread
): Promise<ThreadOutcome> {
    const outcome: ThreadOutcome = { stored: [], skipped: [], failed: [], notFound: [] };
    const threadItem = toThreadDiscoveredItem(discovered, context.accountEmail);

    try {
        // A thread the host already holds is confirmed unchanged without
        // bodies: minimal format carries message ids and labels only.
        if (
            !context.force &&
            context.sink.lastSyncedHash &&
            context.known.has(discovered.threadId)
        ) {
            const previous = await context.sink.lastSyncedHash(threadItem);
            if (previous) {
                let minimal;
                try {
                    minimal = await context.client.getThread(discovered.threadId, "minimal");
                } catch (error) {
                    if (error instanceof GmailNotFoundError) {
                        outcome.notFound.push(discovered.threadId);
                        return outcome;
                    }
                    throw error;
                }
                const current = threadFingerprint(
                    threadMessages(minimal).map(message => message.id)
                );
                if (current === previous) {
                    outcome.skipped.push({ sourceId: discovered.threadId, reason: "unchanged" });
                    return outcome;
                }
            }
        }

        const collected = await collectGmailThread(context.client, discovered, {
            labelNames: context.labelNames,
            accountEmail: context.accountEmail,
            maxItemBytes: context.maxItemBytes,
        });
        if (collected.kind === "skipped") {
            outcome.skipped.push(collected.value);
            return outcome;
        }
        if (collected.kind === "not-found") {
            outcome.notFound.push(collected.threadId);
            return outcome;
        }

        outcome.stored.push(await context.sink.store(collected.value));

        if (!context.includeAttachments) return outcome;
        for (const ref of collected.rendered.attachments) {
            const item = toAttachmentDiscoveredItem(
                discovered.threadId,
                ref,
                collected.rendered,
                context.accountEmail
            );
            try {
                if (!context.force && context.sink.lastSyncedHash) {
                    const previous = await context.sink.lastSyncedHash(item);
                    if (previous === attachmentFingerprint(ref)) {
                        outcome.skipped.push({ sourceId: item.sourceId, reason: "unchanged" });
                        continue;
                    }
                }
                const attachment = await collectGmailAttachment(
                    context.client,
                    item,
                    ref,
                    context.attachmentPolicy
                );
                if (attachment.kind === "skipped") outcome.skipped.push(attachment.value);
                else if (attachment.kind === "not-found")
                    outcome.notFound.push(attachment.sourceId);
                else outcome.stored.push(await context.sink.store(attachment.value));
            } catch (error) {
                outcome.failed.push({ sourceId: item.sourceId, error: describeError(error) });
            }
        }
    } catch (error) {
        outcome.failed.push({ sourceId: discovered.threadId, error: describeError(error) });
    }
    return outcome;
}

export async function syncGmail(options: GmailSyncOptions): Promise<GmailSyncResult> {
    const { client, sink } = options;
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();
    const force = options.force ?? false;
    const known = new Set(options.knownSourceIds ?? []);
    const knownThreadIds = new Set([...known].map(threadIdOfSourceId));

    function report(
        partial: Omit<GmailSyncResult, "connectorId" | "startedAt" | "finishedAt" | "durationMs">
    ): GmailSyncResult {
        const finishedAt = clock();
        return {
            connectorId: GMAIL_CONNECTOR_ID,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            ...partial,
        };
    }

    // The next cursor is taken *before* the walk: changes that land mid-sync
    // fall after it and surface next run instead of being lost.
    const profile = await client.getProfile();
    const nextHistoryId = profile.historyId;
    const accountEmail = profile.emailAddress ?? null;

    let changed: Set<string> | null = null;
    let historyExpired = false;
    if (options.historyId && !force) {
        changed = await changedThreadsSince(client, options.historyId);
        if (changed === null) {
            historyExpired = true;
        } else if (changed.size === 0) {
            return report({
                dirty: false,
                nextHistoryId,
                historyExpired: false,
                discovered: 0,
                stored: [],
                skipped: [],
                failed: [],
                missingSourceIds: [],
                notFound: [],
                truncated: false,
                changedThreads: 0,
                accountEmail,
            });
        }
    }
    const fullRun = changed === null;

    const labels = await client.listLabels();
    const labelNames = new Map(labels.map(label => [label.id, label.name] as const));

    const discovery = await discoverGmailThreads({
        client,
        selectors: options.selectors,
        maxThreads: options.maxThreads,
    });

    // Incremental runs touch the threads the history named plus any the
    // selectors newly match (a time-relative query rolls without history).
    const candidates = fullRun
        ? discovery.threads
        : discovery.threads.filter(
              thread => changed!.has(thread.threadId) || !knownThreadIds.has(thread.threadId)
          );

    const context: ProcessContext = {
        client,
        sink,
        force,
        known: knownThreadIds,
        labelNames,
        accountEmail,
        maxItemBytes: options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES,
        includeAttachments: options.includeAttachments ?? true,
        attachmentPolicy: options.attachmentPolicy ?? {},
    };

    const outcomes = await runWithConcurrency(
        candidates.map(thread => () => processThread(context, thread)),
        options.concurrency ?? DEFAULT_SYNC_CONCURRENCY
    );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [...discovery.skipped];
    const failed: FailedKnowledgeItem[] = [];
    const notFound: string[] = [];
    for (const outcome of outcomes) {
        stored.push(...outcome.stored);
        skipped.push(...outcome.skipped);
        failed.push(...outcome.failed);
        notFound.push(...outcome.notFound);
    }

    // Only a complete walk can say what is gone; an incremental run saw a
    // slice. A truncated walk cannot say either.
    let missingSourceIds: string[] = [];
    if (fullRun && !discovery.truncated) {
        const discoveredIds = new Set(discovery.threads.map(thread => thread.threadId));
        const gone = new Set(notFound.map(threadIdOfSourceId));
        missingSourceIds = [...known].filter(id => {
            const threadId = threadIdOfSourceId(id);
            return !discoveredIds.has(threadId) && !gone.has(threadId);
        });
    }

    return report({
        dirty: true,
        nextHistoryId,
        historyExpired,
        discovered: candidates.length,
        stored,
        skipped,
        failed,
        missingSourceIds,
        notFound,
        truncated: discovery.truncated,
        changedThreads: fullRun ? null : changed!.size,
        accountEmail,
    });
}
