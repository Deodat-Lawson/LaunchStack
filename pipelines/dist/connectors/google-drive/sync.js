/**
 * One Drive sync run: dirty-check → discover → fingerprint-compare → collect →
 * store. Under drive.file the changes feed contains only files this app was
 * granted, so an empty feed proves nothing changed and an idle run costs one
 * API call. The connector never touches the database — the host's
 * `KnowledgeSink` owns storage, and `knownSourceIds` (what the host already
 * ingested) is how deletions are noticed.
 */
import { collectDriveItem, DEFAULT_MAX_ITEM_BYTES } from "./collect.js";
import { describeError, discoverDriveItems, driveFingerprint, GOOGLE_DRIVE_CONNECTOR_ID, } from "./discover.js";
export const DEFAULT_SYNC_CONCURRENCY = 4;
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
        while (true) {
            const index = cursor++;
            const task = tasks[index];
            if (!task)
                return;
            results[index] = await task();
        }
    });
    await Promise.all(workers);
    return results;
}
/**
 * Pages through the changes feed. Any entry at all counts as dirty — the feed
 * is already scoped to granted files, and correctness never depends on this
 * (a dirty verdict just unlocks the full re-discover).
 */
async function checkChangesFeed(client, startPageToken) {
    let pageToken = startPageToken;
    let dirty = false;
    let nextStartPageToken = null;
    while (pageToken) {
        const page = await client.listChanges(pageToken);
        if (page.changes.length > 0)
            dirty = true;
        if (page.newStartPageToken)
            nextStartPageToken = page.newStartPageToken;
        pageToken = page.nextPageToken ?? "";
    }
    return { dirty, nextStartPageToken };
}
async function processItem(client, item, sink, force, maxItemBytes) {
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
        if (collected.kind === "skipped")
            return collected;
        if (collected.kind === "access-lost")
            return collected;
        return { kind: "stored", value: await sink.store(collected.value) };
    }
    catch (error) {
        return {
            kind: "failed",
            value: { sourceId: item.sourceId, error: describeError(error) },
        };
    }
}
export async function syncGoogleDrive(options) {
    const { client, pickedItems, sink } = options;
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();
    function report(partial) {
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
    const outcomes = await runWithConcurrency(discovery.items.map(item => () => processItem(client, item, sink, options.force ?? false, options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES)), options.concurrency ?? DEFAULT_SYNC_CONCURRENCY);
    const stored = [];
    const skipped = [...discovery.skipped];
    const failed = [];
    const accessLost = new Set(discovery.accessLost);
    for (const outcome of outcomes) {
        if (outcome.kind === "stored")
            stored.push(outcome.value);
        else if (outcome.kind === "skipped")
            skipped.push(outcome.value);
        else if (outcome.kind === "failed")
            failed.push(outcome.value);
        else
            accessLost.add(outcome.fileId);
    }
    const discoveredIds = new Set(discovery.items.map(item => item.sourceId));
    const missingSourceIds = (options.knownSourceIds ?? []).filter(id => !discoveredIds.has(id) && !accessLost.has(id));
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
//# sourceMappingURL=sync.js.map