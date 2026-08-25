/**
 * Scan → read → push, in one call.
 *
 * The connector owns discovery, change detection and error containment; the
 * host owns storage. `syncAgentKnowledge` never throws for a single bad file —
 * one unreadable skill must not abort a 200-file sync — so callers always get
 * a report describing exactly what landed.
 */
import type { KnowledgeSink, KnowledgeSyncReport } from "../types.js";
import { type AgentKnowledgeScan, type AgentKnowledgeScanOptions } from "./discover.js";
export declare const DEFAULT_SYNC_CONCURRENCY = 4;
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
/**
 * Fetch every piece of pre-existing Claude Code / Codex knowledge on this
 * machine and push it into the host's knowledge base.
 */
export declare function syncAgentKnowledge(
    options: AgentKnowledgeSyncOptions
): Promise<AgentKnowledgeSyncResult>;
//# sourceMappingURL=sync.d.ts.map
