/**
 * One Drive sync run: dirty-check → discover → fingerprint-compare → collect →
 * store. Under drive.file the changes feed contains only files this app was
 * granted, so an empty feed proves nothing changed and an idle run costs one
 * API call. The connector never touches the database — the host's
 * `KnowledgeSink` owns storage, and `knownSourceIds` (what the host already
 * ingested) is how deletions are noticed.
 */

import type {
    FailedKnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import type { DriveClient } from "./client";
import { collectDriveItem, DEFAULT_MAX_ITEM_BYTES } from "./collect";
import {
    describeError,
    discoverDriveItems,
    driveFingerprint,
    GOOGLE_DRIVE_CONNECTOR_ID,
    type DriveDiscoveredItem,
    type PickedDriveItem,
} from "./discover";

export const DEFAULT_SYNC_CONCURRENCY = 4;

export interface GoogleDriveSyncOptions {
    readonly client: DriveClient;
    readonly pickedItems: readonly PickedDriveItem[];
    readonly sink: KnowledgeSink;
    /**
     * Changes-feed cursor from the previous run. When present (and `force` is
     * off), an empty feed short-circuits the whole run.
     */
    readonly startPageToken?: string;
    /** Source ids the host has already ingested; absent ones are reported missing. */
    readonly knownSourceIds?: readonly string[];
    readonly force?: boolean;
    readonly maxItemBytes?: number;
    readonly maxItems?: number;
    /** Parallel collect+store pipelines. Defaults to 4. */
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface GoogleDriveSyncResult extends KnowledgeSyncReport {
    /** False → the changes feed was empty and nothing else ran. */
    readonly dirty: boolean;
    /** Persist after a successful run; next run's dirty-check starts here. */
    readonly nextStartPageToken: string | null;
    /** Previously-ingested files that no longer appear in the picked scope. */
    readonly missingSourceIds: readonly string[];
    /** Files answering 403/404 — deleted or de-granted; re-pick refreshes access. */
    readonly accessLost: readonly string[];
    readonly truncated: boolean;
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

interface DirtyCheck {
    readonly dirty: boolean;
    readonly nextStartPageToken: string | null;
}

/**
 * Pages through the changes feed. Any entry at all counts as dirty — the feed
 * is already scoped to granted files, and correctness never depends on this
 * (a dirty verdict just unlocks the full re-discover).
 */
async function checkChangesFeed(client: DriveClient, startPageToken: string): Promise<DirtyCheck> {
    let pageToken = startPageToken;
    let dirty = false;
    let nextStartPageToken: string | null = null;

    while (pageToken) {
        const page = await client.listChanges(pageToken);
        if (page.changes.length > 0) dirty = true;
        if (page.newStartPageToken) nextStartPageToken = page.newStartPageToken;
        pageToken = page.nextPageToken ?? "";
    }

    return { dirty, nextStartPageToken };
}

type ItemOutcome =
    | { readonly kind: "stored"; readonly value: StoredKnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "failed"; readonly value: FailedKnowledgeItem }
    | { readonly kind: "access-lost"; readonly fileId: string };

async function processItem(
    client: DriveClient,
    item: DriveDiscoveredItem,
    sink: KnowledgeSink,
    force: boolean,
    maxItemBytes: number
): Promise<ItemOutcome> {
    try {
        // Fingerprints come from listing metadata, so the unchanged case
        // never downloads a byte.
        if (!force && sink.lastSyncedHash) {
            const previous = await sink.lastSyncedHash(item);
            if (previous === driveFingerprint(item.driveFile)) {
                return { kind: "skipped", value: { sourceId: item.sourceId, reason: "unchanged" } };
            }
        }

        const collected = await collectDriveItem(client, item, maxItemBytes);
        if (collected.kind === "skipped") return collected;
        if (collected.kind === "access-lost") return collected;

        return { kind: "stored", value: await sink.store(collected.value) };
    } catch (error) {
        return {
            kind: "failed",
            value: { sourceId: item.sourceId, error: describeError(error) },
        };
    }
}

export async function syncGoogleDrive(
    options: GoogleDriveSyncOptions
): Promise<GoogleDriveSyncResult> {
    const { client, pickedItems, sink } = options;
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();

    function report(
        partial: Omit<
            GoogleDriveSyncResult,
            "connectorId" | "startedAt" | "finishedAt" | "durationMs"
        >
    ): GoogleDriveSyncResult {
        const finishedAt = clock();
        return {
            connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            ...partial,
        };
    }

    if (options.startPageToken && !options.force) {
        const check = await checkChangesFeed(client, options.startPageToken);
        if (!check.dirty) {
            return report({
                dirty: false,
                nextStartPageToken: check.nextStartPageToken ?? options.startPageToken,
                discovered: 0,
                stored: [],
                skipped: [],
                failed: [],
                missingSourceIds: [],
                accessLost: [],
                truncated: false,
            });
        }
    }

    // The next cursor is taken *before* the walk: changes that land mid-sync
    // fall after it and surface as dirty on the next run instead of being lost.
    const nextStartPageToken = await client.getStartPageToken();

    const discovery = await discoverDriveItems({
        client,
        pickedItems,
        maxItems: options.maxItems,
    });

    const outcomes = await runWithConcurrency(
        discovery.items.map(
            item => () =>
                processItem(
                    client,
                    item,
                    sink,
                    options.force ?? false,
                    options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES
                )
        ),
        options.concurrency ?? DEFAULT_SYNC_CONCURRENCY
    );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [...discovery.skipped];
    const failed: FailedKnowledgeItem[] = [];
    const accessLost = new Set<string>(discovery.accessLost);

    for (const outcome of outcomes) {
        if (outcome.kind === "stored") stored.push(outcome.value);
        else if (outcome.kind === "skipped") skipped.push(outcome.value);
        else if (outcome.kind === "failed") failed.push(outcome.value);
        else accessLost.add(outcome.fileId);
    }

    const discoveredIds = new Set(discovery.items.map(item => item.sourceId));
    const missingSourceIds = (options.knownSourceIds ?? []).filter(
        id => !discoveredIds.has(id) && !accessLost.has(id)
    );

    return report({
        dirty: true,
        nextStartPageToken,
        discovered: discovery.items.length,
        stored,
        skipped,
        failed,
        missingSourceIds,
        accessLost: [...accessLost],
        truncated: discovery.truncated,
    });
}
