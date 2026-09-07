/**
 * Scan → parse → render → push, in one call.
 *
 * Mirrors the agent-knowledge sync: the connector owns discovery, parsing and
 * error containment; the host owns storage through the `KnowledgeSink` seam.
 * One corrupt rollout must not abort a 200-session import, so every per-file
 * failure lands in the report instead of throwing.
 */
import type { KnowledgeSink, KnowledgeSyncReport } from "../types.js";
import { type AgentSessionsScan, type AgentSessionsScanOptions } from "./discover.js";
export interface AgentSessionsSyncOptions extends AgentSessionsScanOptions {
    readonly sink: KnowledgeSink;
    /** Parallel `sink.store` calls. Defaults to 4. */
    readonly concurrency?: number;
    /** Re-upload even when the sink reports an identical content hash. */
    readonly force?: boolean;
}
export interface AgentSessionsSyncResult extends KnowledgeSyncReport {
    readonly scan: AgentSessionsScan;
    readonly truncated: boolean;
}
/**
 * Import every finished Claude Code / Codex session on this machine into the
 * host's knowledge base, newest first.
 */
export declare function syncAgentSessions(options: AgentSessionsSyncOptions): Promise<AgentSessionsSyncResult>;
//# sourceMappingURL=sync.d.ts.map