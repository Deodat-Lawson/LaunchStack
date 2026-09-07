/**
 * What to do with each Drive MIME type: download it, export it (Google-native
 * files have no bytes of their own), recurse into it, or skip it with a
 * reason. Export targets are chosen to land on ingestion adapters that
 * already exist — see MIME_TO_SOURCE_TYPE in @launchstack/conversion/types.
 */
import type { DriveFile } from "./client.js";
export declare const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export declare const GOOGLE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export type DriveAction = {
    readonly action: "download";
} | {
    readonly action: "export";
    /** MIME to request from files.export, and what ingestion receives. */
    readonly exportMime: string;
    /** Appended to the filename so the ingestion router picks the right adapter. */
    readonly extension: string;
} | {
    readonly action: "recurse";
} | {
    readonly action: "resolve-shortcut";
} | {
    readonly action: "skip";
    readonly reason: string;
};
export declare function resolveDriveAction(file: Pick<DriveFile, "mimeType">): DriveAction;
//# sourceMappingURL=export-rules.d.ts.map