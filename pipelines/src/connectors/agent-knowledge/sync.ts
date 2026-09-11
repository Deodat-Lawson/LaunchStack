/**
 * Scan → read → push, in one call.
 *
 * The connector owns discovery, change detection and error containment; the
 * host owns storage. `syncAgentKnowledge` never throws for a single bad file —
 * one unreadable skill must not abort a 200-file sync — so callers always get
 * a report describing exactly what landed.
 */

import type {
    KnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    FailedKnowledgeItem,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import { collectAgentKnowledge } from "./collect";
import {
    AGENT_KNOWLEDGE_CONNECTOR_ID,
    describeError,
    scanAgentKnowledge,
    type AgentKnowledgeScan,
    type AgentKnowledgeScanOptions,
} from "./discover";

export const DEFAULT_SYNC_CONCURRENCY = 4;

export interface AgentKnowledgeSyncOptions extends AgentKnowledgeScanOptions {
    readonly sink: KnowledgeSink;
    /** Parallel `sink.store` calls. Defaults to 4. */
    readonly concurrency?: number;
    /** Re-upload even when the sink reports an identical content hash. */
    readonly force?: boolean;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface AgentKnowledgeSyncResult extends KnowledgeSyncReport {
    readonly scan: AgentKnowledgeScan;
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

type StoreOutcome =
    | { readonly kind: "stored"; readonly value: StoredKnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "failed"; readonly value: FailedKnowledgeItem };

async function storeItem(
    item: KnowledgeItem,
    sink: KnowledgeSink,
    force: boolean
): Promise<StoreOutcome> {
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
export async function syncAgentKnowledge(
    options: AgentKnowledgeSyncOptions
): Promise<AgentKnowledgeSyncResult> {
    const { sink, concurrency, force, now, ...scanOptions } = options;
    const clock = now ?? (() => new Date());
    const startedAt = clock();

    const scan = await scanAgentKnowledge(scanOptions);
    const collected = await collectAgentKnowledge(scan.items);

    const outcomes = await runWithConcurrency(
        collected.items.map(item => () => storeItem(item, sink, force ?? false)),
        concurrency ?? DEFAULT_SYNC_CONCURRENCY
    );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [...scan.skipped, ...collected.skipped];
    const failed: FailedKnowledgeItem[] = [];

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
