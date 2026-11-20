/**
 * One Microsoft 365 sync run: discover → fingerprint-compare → collect →
 * store. There is no cheap "did anything change" cursor here, so every run
 * walks what was picked; the walk is listings only, and a file whose
 * fingerprint the sink already holds is never downloaded. The connector never
 * touches the database — the host's `KnowledgeSink` owns storage, and
 * `knownSourceIds` (what the host already ingested) is how deletions are
 * noticed.
 */

import {
    DELETED_HERE_DETAIL,
    SourceDeletedError,
    type FailedKnowledgeItem,
    type KnowledgeSink,
    type KnowledgeSyncReport,
    type SkippedKnowledgeItem,
    type StoredKnowledgeItem,
} from "../types";
import type { Microsoft365Client } from "./client";
import { collectMicrosoft365Item, DEFAULT_MAX_ITEM_BYTES } from "./collect";
import {
    describeError,
    discoverMicrosoft365Items,
    MICROSOFT_365_CONNECTOR_ID,
    microsoft365Fingerprint,
    type Microsoft365DiscoveredItem,
    type PickedMicrosoft365Item,
} from "./discover";

export const DEFAULT_SYNC_CONCURRENCY = 4;

export interface Microsoft365SyncOptions {
    readonly client: Microsoft365Client;
    readonly pickedItems: readonly PickedMicrosoft365Item[];
    readonly sink: KnowledgeSink;
    /** Source ids the host has already ingested; absent ones are reported missing. */
    readonly knownSourceIds?: readonly string[];
    /**
     * Files someone deleted in the host. A picked folder still reaches them,
     * so without this every run would import them again; they are skipped
     * before anything is downloaded.
     */
    readonly deletedSourceIds?: readonly string[];
    /** Re-upload everything, fingerprints notwithstanding. */
    readonly force?: boolean;
    readonly maxItemBytes?: number;
    readonly maxItems?: number;
    /** Parallel collect+store pipelines. Defaults to 4. */
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface Microsoft365SyncResult extends KnowledgeSyncReport {
    /** False → the walk found nothing new, changed or gone. */
    readonly dirty: boolean;
    /**
     * Previously-ingested files that no longer appear in the picked scope.
     * Empty whenever the walk was cut short or could not read a folder: an
     * item it never reached is not an item that is gone.
     */
    readonly missingSourceIds: readonly string[];
    /** Source ids answering 403/404 — deleted or no longer shared; re-pick refreshes access. */
    readonly accessLost: readonly string[];
    /** Picked folders (as source ids) that listed empty. */
    readonly emptyFolders: readonly string[];
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

function deletedHereSkip(sourceId: string): SkippedKnowledgeItem {
    return { sourceId, reason: "excluded", detail: DELETED_HERE_DETAIL };
}

type ItemOutcome =
    | { readonly kind: "stored"; readonly value: StoredKnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "failed"; readonly value: FailedKnowledgeItem }
    | { readonly kind: "access-lost"; readonly sourceId: string };

async function processItem(
    client: Microsoft365Client,
    item: Microsoft365DiscoveredItem,
    sink: KnowledgeSink,
    force: boolean,
    maxItemBytes: number
): Promise<ItemOutcome> {
    try {
        // Fingerprints come from listing metadata, so the unchanged case
        // never downloads a byte.
        if (!force && sink.lastSyncedHash) {
            const previous = await sink.lastSyncedHash(item);
            if (previous === microsoft365Fingerprint(item.driveItem)) {
                return { kind: "skipped", value: { sourceId: item.sourceId, reason: "unchanged" } };
            }
        }

        const collected = await collectMicrosoft365Item(client, item, maxItemBytes);
        if (collected.kind === "skipped") return collected;
        if (collected.kind === "access-lost") return collected;

        return { kind: "stored", value: await sink.store(collected.value) };
    } catch (error) {
        if (error instanceof SourceDeletedError) {
            return { kind: "skipped", value: deletedHereSkip(item.sourceId) };
        }
        return {
            kind: "failed",
            value: { sourceId: item.sourceId, error: describeError(error) },
        };
    }
}

export async function syncMicrosoft365(
    options: Microsoft365SyncOptions
): Promise<Microsoft365SyncResult> {
    const { client, pickedItems, sink } = options;
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();

    const discovery = await discoverMicrosoft365Items({
        client,
        pickedItems,
        maxItems: options.maxItems,
    });

    // Deleted here: still in OneDrive, still reached by a pick, left out.
    const deleted = new Set(options.deletedSourceIds ?? []);
    const toSync = discovery.items.filter(item => !deleted.has(item.sourceId));
    const deletedHere = discovery.items
        .filter(item => deleted.has(item.sourceId))
        .map(item => deletedHereSkip(item.sourceId));

    const outcomes = await runWithConcurrency(
        toSync.map(
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
    const skipped: SkippedKnowledgeItem[] = [...discovery.skipped, ...deletedHere];
    const failed: FailedKnowledgeItem[] = [];
    const accessLost = new Set<string>(discovery.accessLost);

    for (const outcome of outcomes) {
        if (outcome.kind === "stored") stored.push(outcome.value);
        else if (outcome.kind === "skipped") skipped.push(outcome.value);
        else if (outcome.kind === "failed") failed.push(outcome.value);
        else accessLost.add(outcome.sourceId);
    }

    // Only a walk that reached everything can say what is gone. A truncated
    // one stopped early, and a folder that would not list hides files that
    // may all still be there.
    let missingSourceIds: string[] = [];
    if (discovery.complete) {
        const discoveredIds = new Set(discovery.items.map(item => item.sourceId));
        missingSourceIds = (options.knownSourceIds ?? []).filter(
            id => !discoveredIds.has(id) && !accessLost.has(id)
        );
    }

    const finishedAt = clock();
    return {
        connectorId: MICROSOFT_365_CONNECTOR_ID,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        dirty: stored.length > 0 || missingSourceIds.length > 0,
        discovered: discovery.items.length,
        stored,
        skipped,
        failed,
        missingSourceIds,
        accessLost: [...accessLost],
        emptyFolders: discovery.emptyFolders,
        truncated: discovery.truncated,
    };
}
