/**
 * Reading half of the connector: turns discovered files into
 * `KnowledgeItem`s with contents and a content hash.
 */
import type { DiscoveredKnowledgeItem, KnowledgeItem, SkippedKnowledgeItem } from "../types.js";
export interface CollectedAgentKnowledge {
    readonly items: readonly KnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
}
export declare function hashContent(content: string): string;
export declare function readKnowledgeItem(
    item: DiscoveredKnowledgeItem
): Promise<KnowledgeItem | SkippedKnowledgeItem>;
/** Read every discovered item, keeping failures as skips rather than throwing. */
export declare function collectAgentKnowledge(
    discovered: readonly DiscoveredKnowledgeItem[]
): Promise<CollectedAgentKnowledge>;
//# sourceMappingURL=collect.d.ts.map
