/**
 * Discovered item → `KnowledgeItem` with real bytes. Size caps and empty
 * files become skips with reasons — one oversized file must not abort a sync.
 */

import type { KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { Microsoft365AccessError, type Microsoft365Client } from "./client";
import {
    describeError,
    microsoft365Fingerprint,
    type Microsoft365DiscoveredItem,
} from "./discover";

/** Above this we skip rather than pull bytes through the sync. */
export const DEFAULT_MAX_ITEM_BYTES = 50 * 1024 * 1024;

export type CollectOutcome =
    | { readonly kind: "item"; readonly value: KnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "access-lost"; readonly sourceId: string };

export async function collectMicrosoft365Item(
    client: Microsoft365Client,
    item: Microsoft365DiscoveredItem,
    maxItemBytes: number = DEFAULT_MAX_ITEM_BYTES
): Promise<CollectOutcome> {
    // Graph reports every file's size, so both ends of the range are settled
    // before a byte moves.
    if (item.driveItem.size === 0) {
        return { kind: "skipped", value: { sourceId: item.sourceId, reason: "empty" } };
    }
    if (item.bytes > maxItemBytes) {
        return {
            kind: "skipped",
            value: {
                sourceId: item.sourceId,
                reason: "too-large",
                detail: `${item.bytes} bytes exceeds the ${maxItemBytes}-byte cap`,
            },
        };
    }

    try {
        const content = await client.download(item.driveId, item.driveItem.id);

        if (content.byteLength === 0) {
            return {
                kind: "skipped",
                value: { sourceId: item.sourceId, reason: "empty" },
            };
        }
        if (content.byteLength > maxItemBytes) {
            return {
                kind: "skipped",
                value: {
                    sourceId: item.sourceId,
                    reason: "too-large",
                    detail: `download produced ${content.byteLength} bytes`,
                },
            };
        }

        // The fingerprint is the listing's, not a hash of the bytes, so the
        // next run can compare without downloading.
        return {
            kind: "item",
            value: {
                ...item,
                bytes: content.byteLength,
                content,
                contentHash: microsoft365Fingerprint(item.driveItem),
            },
        };
    } catch (error) {
        if (error instanceof Microsoft365AccessError) {
            return { kind: "access-lost", sourceId: item.sourceId };
        }
        return {
            kind: "skipped",
            value: { sourceId: item.sourceId, reason: "unreadable", detail: describeError(error) },
        };
    }
}
