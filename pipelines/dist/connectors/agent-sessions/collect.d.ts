/**
 * Reading half of the connector: opens a discovered session file, parses it
 * with the dialect parser for its tool, and renders the Markdown transcript
 * that becomes the stored `KnowledgeItem`.
 */
import type { DiscoveredKnowledgeItem, KnowledgeItem, SkippedKnowledgeItem } from "../types.js";
export interface SessionCollectContext {
    /** Codex thread titles from `~/.codex/session_index.jsonl`, by session id. */
    readonly codexTitles?: ReadonlyMap<string, string>;
}
export interface CollectedAgentSessions {
    readonly items: readonly KnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
}
export declare function hashContent(content: string): string;
/**
 * Codex names its threads in a separate index file rather than in the rollout,
 * so titles are joined in from there. The index is small and append-only; the
 * last entry for an id wins.
 */
export declare function loadCodexSessionIndex(homeDir: string): Promise<Map<string, string>>;
export declare function readSessionItem(item: DiscoveredKnowledgeItem, context?: SessionCollectContext): Promise<KnowledgeItem | SkippedKnowledgeItem>;
/** Read and render every discovered session, keeping failures as skips. */
export declare function collectAgentSessions(discovered: readonly DiscoveredKnowledgeItem[], context?: SessionCollectContext): Promise<CollectedAgentSessions>;
//# sourceMappingURL=collect.d.ts.map