/**
 * One Drive sync run: dirty-check → discover → fingerprint-compare → collect →
 * store. Under drive.file the changes feed contains only files this app was
 * granted, so an empty feed proves nothing changed and an idle run costs one
 * API call. The connector never touches the database — the host's
 * `KnowledgeSink` owns storage, and `knownSourceIds` (what the host already
 * ingested) is how deletions are noticed.
 */
import type { KnowledgeSink, KnowledgeSyncReport } from "../types.js";
import type { DriveClient } from "./client.js";
import { type PickedDriveItem } from "./discover.js";
export declare const DEFAULT_SYNC_CONCURRENCY = 4;
export interface GoogleDriveSyncOptions {
    readonly client: DriveClient;
    readonly pickedItems: readonly PickedDriveItem[];
    readonly sink: KnowledgeSink;
    /**
     * Changes-feed cursor from the previous run. When present (and `force` is
     * off), an empty feed short-circuits the whole run.
     */
    readonly startPageToken?: string;
    /** Source ids the host has already ingested; absent ones are reported missing. */
    readonly knownSourceIds?: readonly string[];
    readonly force?: boolean;
    readonly maxItemBytes?: number;
    readonly maxItems?: number;
    /** Parallel collect+store pipelines. Defaults to 4. */
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}
export interface GoogleDriveSyncResult extends KnowledgeSyncReport {
    /** False → the changes feed was empty and nothing else ran. */
    readonly dirty: boolean;
    /** Persist after a successful run; next run's dirty-check starts here. */
    readonly nextStartPageToken: string | null;
    /** Previously-ingested files that no longer appear in the picked scope. */
    readonly missingSourceIds: readonly string[];
    /** Files answering 403/404 — deleted or de-granted; re-pick refreshes access. */
    readonly accessLost: readonly string[];
    readonly truncated: boolean;
}
export declare function syncGoogleDrive(options: GoogleDriveSyncOptions): Promise<GoogleDriveSyncResult>;
//# sourceMappingURL=sync.d.ts.map