/**
 * Scan → read → push, in one call.
 *
 * The connector owns discovery, change detection and error containment; the
 * host owns storage. `syncAgentKnowledge` never throws for a single bad file —
 * one unreadable skill must not abort a 200-file sync — so callers always get
 * a report describing exactly what landed.
 */
import { collectAgentKnowledge } from "./collect.js";
import { AGENT_KNOWLEDGE_CONNECTOR_ID, describeError, scanAgentKnowledge } from "./discover.js";
export const DEFAULT_SYNC_CONCURRENCY = 4;
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
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
async function storeItem(item, sink, force) {
    try {
        if (!force && sink.lastSyncedHash) {
            const previous = await sink.lastSyncedHash(item);
            if (previous === item.contentHash) {
                return { kind: "skipped", value: { sourceId: item.sourceId, reason: "unchanged" } };
            }
        }
        return { kind: "stored", value: await sink.store(item) };
    } catch (error) {
        return {
            kind: "failed",
            value: { sourceId: item.sourceId, error: describeError(error) },
        };
    }
}
/**
 * Fetch every piece of pre-existing Claude Code / Codex knowledge on this
 * machine and push it into the host's knowledge base.
 */
export async function syncAgentKnowledge(options) {
    const { sink, concurrency, force, now, ...scanOptions } = options;
    const clock = now ?? (() => new Date());
    const startedAt = clock();
    const scan = await scanAgentKnowledge(scanOptions);
    const collected = await collectAgentKnowledge(scan.items);
    const outcomes = await runWithConcurrency(
        collected.items.map(item => () => storeItem(item, sink, force ?? false)),
        concurrency ?? DEFAULT_SYNC_CONCURRENCY
    );
    const stored = [];
    const skipped = [...scan.skipped, ...collected.skipped];
    const failed = [];
    for (const outcome of outcomes) {
        if (outcome.kind === "stored") stored.push(outcome.value);
        else if (outcome.kind === "skipped") skipped.push(outcome.value);
        else failed.push(outcome.value);
    }
    const finishedAt = clock();
    return {
        connectorId: AGENT_KNOWLEDGE_CONNECTOR_ID,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        discovered: scan.items.length,
        stored,
        skipped,
        failed,
        scan,
        truncated: scan.truncated,
    };
}
//# sourceMappingURL=sync.js.map
