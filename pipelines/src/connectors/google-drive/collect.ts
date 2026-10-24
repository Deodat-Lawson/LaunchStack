/**
 * Discovered item → `KnowledgeItem` with real bytes: download for regular
 * files, export for Google-native ones. Size caps and export-cap errors become
 * skips with reasons — one oversized file must not abort a sync.
 */

import type { KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { DriveAccessError, DriveExportTooLargeError, type DriveClient } from "./client";
import {
    describeError,
    driveFingerprint,
    type DriveContentAction,
    type DriveDiscoveredItem,
} from "./discover";

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
        const action = item.contentAction;
        const fetched =
            action.action === "export"
                ? await exportWithFallback(client, item, action)
                : { item, content: await client.download(item.driveFile.id) };
        const content = fetched.content;

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
            value: { ...fetched.item, content, contentHash: driveFingerprint(item.driveFile) },
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

/**
 * Export in the rule's format; when Drive refuses that as over its export cap
 * and the rule names a fallback, export that instead, and the item carries
 * the fallback's MIME and extension so the copy is stored and parsed as what
 * it is.
 */
async function exportWithFallback(
    client: DriveClient,
    item: DriveDiscoveredItem,
    action: Extract<DriveContentAction, { action: "export" }>
): Promise<{ readonly item: DriveDiscoveredItem; readonly content: Uint8Array }> {
    try {
        return { item, content: await client.exportFile(item.driveFile.id, action.exportMime) };
    } catch (error) {
        if (!(error instanceof DriveExportTooLargeError) || !action.fallback) throw error;
    }
    const { exportMime, extension } = action.fallback;
    return {
        item: {
            ...item,
            mimeType: exportMime,
            metadata: { ...item.metadata, exportMime, extension },
            contentAction: { action: "export", exportMime, extension },
        },
        content: await client.exportFile(item.driveFile.id, exportMime),
    };
}
