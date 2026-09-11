/**
 * Discovered item → `KnowledgeItem` with real bytes: download for regular
 * files, export for Google-native ones. Size caps and export-cap errors become
 * skips with reasons — one oversized file must not abort a sync.
 */

import type { KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { DriveAccessError, DriveExportTooLargeError, type DriveClient } from "./client";
import { describeError, driveFingerprint, type DriveDiscoveredItem } from "./discover";

/** Above this we skip rather than pull bytes through the sync. */
export const DEFAULT_MAX_ITEM_BYTES = 50 * 1024 * 1024;

export type CollectOutcome =
    | { readonly kind: "item"; readonly value: KnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "access-lost"; readonly fileId: string };

export async function collectDriveItem(
    client: DriveClient,
    item: DriveDiscoveredItem,
    maxItemBytes: number = DEFAULT_MAX_ITEM_BYTES
): Promise<CollectOutcome> {
    // Google-native files report no size; the export cap is enforced by
    // Google and mapped to a skip below.
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
        const content =
            item.contentAction.action === "export"
                ? await client.exportFile(item.driveFile.id, item.contentAction.exportMime)
                : await client.download(item.driveFile.id);

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
                    detail: `export produced ${content.byteLength} bytes`,
                },
            };
        }

        return {
            kind: "item",
            value: { ...item, content, contentHash: driveFingerprint(item.driveFile) },
        };
    } catch (error) {
        if (error instanceof DriveExportTooLargeError) {
            return {
                kind: "skipped",
                value: {
                    sourceId: item.sourceId,
                    reason: "too-large",
                    detail: "exceeds the Drive export size limit",
                },
            };
        }
        if (error instanceof DriveAccessError) {
            return { kind: "access-lost", fileId: item.driveFile.id };
        }
        return {
            kind: "skipped",
            value: { sourceId: item.sourceId, reason: "unreadable", detail: describeError(error) },
        };
    }
}
