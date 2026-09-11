/**
 * Filesystem discovery for the agent-sessions connector.
 *
 * Session transcripts live in exactly two well-known layouts:
 *
 *   ~/.claude/projects/<slug>/<session-uuid>.jsonl
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl   (+ archived_sessions)
 *
 * Discovery is stat-only — nothing is opened here — and unlike the
 * agent-knowledge walk it is newest-first: the sessions worth having in a
 * knowledge base are the recent ones, so when `maxSessions` cuts a first bulk
 * import short it is the tail of history that waits for the next run.
 */
import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types.js";
import { type SessionToolId } from "./types.js";
export declare const AGENT_SESSIONS_CONNECTOR_ID = "agent-sessions";
/**
 * 64 MiB. Session files run far larger than knowledge files (45 MB observed in
 * the wild); the cap exists to refuse the pathological, not the typical.
 */
export declare const DEFAULT_MAX_SESSION_FILE_BYTES: number;
export declare const DEFAULT_MAX_SESSIONS = 200;
/**
 * A file modified inside this window is still being written by a live session.
 * Reading it now is safe (JSONL parses line by line) but would mint a new
 * document version per prompt, so it waits for the next sync instead.
 */
export declare const DEFAULT_QUIESCENCE_MS: number;
export interface AgentSessionsScanOptions {
    /** Defaults to `os.homedir()`. */
    readonly homeDir?: string;
    /** Defaults to every known tool. */
    readonly tools?: readonly SessionToolId[];
    /**
     * Claude Code project-directory slugs to include (the directory names
     * under `~/.claude/projects`). Empty or absent means every project. Codex
     * sessions carry no project at discovery time and are unaffected.
     */
    readonly projects?: readonly string[];
    /** Include `~/.codex/archived_sessions`. On by default. */
    readonly includeArchived?: boolean;
    /**
     * Import exactly these sessions (`agent-sessions://…` ids from a previous
     * scan). Selection is an explicit user action on sessions already shown in
     * a browser, so the quiescence window does not apply — the parsers are
     * line-tolerant, and "import the session I am looking at" must not fail
     * because that session was active minutes ago.
     */
    readonly sourceIds?: readonly string[];
    readonly maxFileBytes?: number;
    readonly maxSessions?: number;
    readonly quiescenceMs?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}
export interface ScannedSessionRoot {
    readonly toolId: SessionToolId;
    readonly dir: string;
    readonly exists: boolean;
    /** Session files seen under this root, before caps and skips. */
    readonly sessionCount: number;
}
export interface AgentSessionsScan {
    readonly roots: readonly ScannedSessionRoot[];
    /** Newest first. */
    readonly items: readonly DiscoveredKnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** True when `maxSessions` cut the list short. */
    readonly truncated: boolean;
}
/**
 * `agent-sessions://<tool>/<session-uuid>`.
 *
 * Deliberately *not* including the project slug: the slug encodes the absolute
 * path of the checkout (`-Users-me-repo`), and the sourceId is the host's
 * idempotency key, which has to survive a home directory moving. The project
 * lives in metadata and in the rendered provenance header instead.
 */
export declare function buildSessionSourceId(toolId: SessionToolId, sessionUuid: string): string;
export declare function describeError(error: unknown): string;
/**
 * Discover — but do not read — every finished session transcript on this
 * machine. `collectAgentSessions` is the step that opens, parses and renders.
 */
export declare function scanAgentSessions(options?: AgentSessionsScanOptions): Promise<AgentSessionsScan>;
//# sourceMappingURL=discover.d.ts.map