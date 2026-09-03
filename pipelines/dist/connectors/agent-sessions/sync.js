/**
 * Scan → parse → render → push, in one call.
 *
 * Mirrors the agent-knowledge sync: the connector owns discovery, parsing and
 * error containment; the host owns storage through the `KnowledgeSink` seam.
 * One corrupt rollout must not abort a 200-session import, so every per-file
 * failure lands in the report instead of throwing.
 */
import { homedir } from "node:os";
import { collectAgentSessions, loadCodexSessionIndex } from "./collect.js";
import { AGENT_SESSIONS_CONNECTOR_ID, describeError, scanAgentSessions, } from "./discover.js";
const DEFAULT_SYNC_CONCURRENCY = 4;
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
async function storeItem(item, sink, force) {
    try {
        if (!force && sink.lastSyncedHash) {
            const previous = await sink.lastSyncedHash(item);
            if (previous === item.contentHash) {
                return { kind: "skipped", value: { sourceId: item.sourceId, reason: "unchanged" } };
            }
        }
        return { kind: "stored", value: await sink.store(item) };
    }
    catch (error) {
        return {
            kind: "failed",
            value: { sourceId: item.sourceId, error: describeError(error) },
        };
    }
}
/**
 * Import every finished Claude Code / Codex session on this machine into the
 * host's knowledge base, newest first.
 */
export async function syncAgentSessions(options) {
    const { sink, concurrency, force, ...scanOptions } = options;
    const clock = scanOptions.now ?? (() => new Date());
    const startedAt = clock();
    const scan = await scanAgentSessions(scanOptions);
    const wantsCodex = scan.items.some(item => item.metadata.tool === "codex");
    const codexTitles = wantsCodex
        ? await loadCodexSessionIndex(scanOptions.homeDir ?? homedir())
        : undefined;
    const collected = await collectAgentSessions(scan.items, { codexTitles });
    const outcomes = await runWithConcurrency(collected.items.map(item => () => storeItem(item, sink, force ?? false)), concurrency ?? DEFAULT_SYNC_CONCURRENCY);
    const stored = [];
    const skipped = [...scan.skipped, ...collected.skipped];
    const failed = [];
    for (const outcome of outcomes) {
        if (outcome.kind === "stored")
            stored.push(outcome.value);
        else if (outcome.kind === "skipped")
            skipped.push(outcome.value);
        else
            failed.push(outcome.value);
    }
    const finishedAt = clock();
    return {
        connectorId: AGENT_SESSIONS_CONNECTOR_ID,
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