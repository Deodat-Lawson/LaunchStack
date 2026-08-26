/**
 * Filesystem discovery for the agent-knowledge connector.
 *
 * Walks only the locations named in `layout.ts`, never follows symlinks, and
 * refuses to leave the root it was pointed at. Everything it declines to read
 * comes back as a `SkippedKnowledgeItem` so the caller can show the user what
 * was left behind instead of silently under-reporting.
 */
import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types.js";
import { type AgentToolId, type KnowledgeScope } from "./layout.js";
export declare const AGENT_KNOWLEDGE_CONNECTOR_ID = "agent-knowledge";
/** 512 KiB — a knowledge file above this is a transcript, not instructions. */
export declare const DEFAULT_MAX_FILE_BYTES: number;
export declare const DEFAULT_MAX_ITEMS = 500;
export interface ProjectTarget {
    /** Directory to scan for project-scoped agent knowledge. */
    readonly dir: string;
    /**
     * Stable identity for the project inside `sourceId`. Defaults to the
     * directory's basename. Pass an explicit key when two checkouts share a
     * basename, or when the same project may live at different paths.
     */
    readonly key?: string;
}
export interface AgentKnowledgeScanOptions {
    /** Defaults to `os.homedir()`. */
    readonly homeDir?: string;
    /** Project directories to scan. Empty means "global knowledge only". */
    readonly projects?: readonly (ProjectTarget | string)[];
    /** Defaults to every known tool. */
    readonly tools?: readonly AgentToolId[];
    /** Defaults to both scopes (project scope needs `projects`). */
    readonly scopes?: readonly KnowledgeScope[];
    /** Read `settings.json` / `config.toml`. Off by default — they hold keys. */
    readonly includeConfig?: boolean;
    readonly maxFileBytes?: number;
    readonly maxItems?: number;
}
export interface ScannedRoot {
    readonly toolId: AgentToolId;
    readonly scope: KnowledgeScope;
    readonly key: string;
    readonly dir: string;
    readonly exists: boolean;
    readonly itemCount: number;
}
export interface AgentKnowledgeScan {
    readonly roots: readonly ScannedRoot[];
    readonly items: readonly DiscoveredKnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** True when `maxItems` cut the walk short. */
    readonly truncated: boolean;
}
/**
 * `agent-knowledge://<tool>/<scope-key>/<relative-path>`.
 *
 * Deliberately free of absolute paths: this string is the identity the host
 * keys its documents on, and it has to survive the home directory moving.
 */
export declare function buildSourceId(
    toolId: AgentToolId,
    scopeKey: string,
    relativePath: string
): string;
/**
 * Discover — but do not read — every knowledge file the configured tools
 * expose. Cheap enough to run on a page load; `collectAgentKnowledge` is the
 * step that actually opens files.
 */
export declare function scanAgentKnowledge(
    options?: AgentKnowledgeScanOptions
): Promise<AgentKnowledgeScan>;
export declare function describeError(error: unknown): string;
//# sourceMappingURL=discover.d.ts.map
