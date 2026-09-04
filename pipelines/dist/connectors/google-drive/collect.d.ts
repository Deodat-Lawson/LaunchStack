/**
 * Discovered item → `KnowledgeItem` with real bytes: download for regular
 * files, export for Google-native ones. Size caps and export-cap errors become
 * skips with reasons — one oversized file must not abort a sync.
 */
import type { KnowledgeItem, SkippedKnowledgeItem } from "../types.js";
import { type DriveClient } from "./client.js";
import { type DriveDiscoveredItem } from "./discover.js";
/** Above this we skip rather than pull bytes through the sync. */
export declare const DEFAULT_MAX_ITEM_BYTES: number;
export type CollectOutcome = {
    readonly kind: "item";
    readonly value: KnowledgeItem;
} | {
    readonly kind: "skipped";
    readonly value: SkippedKnowledgeItem;
} | {
    readonly kind: "access-lost";
    readonly fileId: string;
};
export declare function collectDriveItem(client: DriveClient, item: DriveDiscoveredItem, maxItemBytes?: number): Promise<CollectOutcome>;
//# sourceMappingURL=collect.d.ts.map