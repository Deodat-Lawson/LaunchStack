/**
 * Picked items → discovered knowledge items, without downloading anything.
 *
 * Folders are walked recursively; shortcuts resolve to their targets; every
 * file gets a fingerprint from listing metadata alone (md5Checksum for
 * binaries, headRevisionId for Google-native files), so an unchanged corpus
 * costs one listing pass and zero downloads.
 */
import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types.js";
import { type DriveClient, type DriveFile } from "./client.js";
import { type DriveAction } from "./export-rules.js";
export declare const GOOGLE_DRIVE_CONNECTOR_ID = "google-drive";
export declare const DEFAULT_MAX_ITEMS = 2000;
export interface PickedDriveItem {
    readonly fileId: string;
    readonly kind: "file" | "folder";
}
export type DriveContentAction = Extract<DriveAction, {
    action: "download" | "export";
}>;
export interface DriveDiscoveredItem extends DiscoveredKnowledgeItem {
    readonly driveFile: DriveFile;
    readonly contentAction: DriveContentAction;
}
export interface DriveDiscovery {
    readonly items: readonly DriveDiscoveredItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** File ids that answered 403/404 — deleted, or the drive.file grant is gone. */
    readonly accessLost: readonly string[];
    readonly truncated: boolean;
}
export interface DiscoverDriveOptions {
    readonly client: DriveClient;
    readonly pickedItems: readonly PickedDriveItem[];
    readonly maxItems?: number;
}
/**
 * Change-detection identity from listing metadata. Prefixed so a later switch
 * of fingerprint source can never collide with an old value.
 */
export declare function driveFingerprint(file: DriveFile): string;
export declare function describeError(error: unknown): string;
export declare function discoverDriveItems(options: DiscoverDriveOptions): Promise<DriveDiscovery>;
//# sourceMappingURL=discover.d.ts.map