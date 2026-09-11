/**
 * Thin Drive v3 client over `fetch` — the eight endpoints the connector needs,
 * and nothing else. Deliberately not `googleapis`: that package is the
 * heaviest dependency it would add to this workspace, and its auth machinery
 * duplicates what the host already owns (tokens live in our database).
 *
 * Every request goes through one retry wrapper (rate limits, 5xx) and every
 * file/changes call carries the shared-drive flags, so files picked from a
 * shared drive just work.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * Every listing carries the fields change detection needs, so a sync can
 * fingerprint an unchanged corpus without a single download.
 */
export declare const DRIVE_FILE_FIELDS = "id,name,mimeType,size,md5Checksum,headRevisionId,version,modifiedTime,trashed,parents,shortcutDetails";
export interface DriveFile {
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly size?: string;
    readonly md5Checksum?: string;
    readonly headRevisionId?: string;
    readonly version?: string;
    readonly modifiedTime?: string;
    readonly trashed?: boolean;
    readonly parents?: readonly string[];
    readonly shortcutDetails?: {
        readonly targetId?: string;
        readonly targetMimeType?: string;
    };
}
export interface DriveFileList {
    readonly files: readonly DriveFile[];
    readonly nextPageToken?: string;
}
export interface DriveChange {
    readonly fileId?: string;
    readonly removed?: boolean;
    readonly file?: DriveFile;
}
export interface DriveChangeList {
    readonly changes: readonly DriveChange[];
    readonly nextPageToken?: string;
    readonly newStartPageToken?: string;
}
/** The file is gone or the app lost its drive.file grant — re-pick territory. */
export declare class DriveAccessError extends Error {
    readonly fileId: string;
    readonly status: number;
    constructor(fileId: string, status: number);
}
/** A Google-native file exceeded the Drive export size cap (~10 MB). */
export declare class DriveExportTooLargeError extends Error {
    readonly fileId: string;
    constructor(fileId: string);
}
export declare class DriveApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export interface DriveClient {
    getFile(fileId: string): Promise<DriveFile>;
    /** One page of a folder's direct, untrashed children. */
    listChildren(folderId: string, pageToken?: string): Promise<DriveFileList>;
    getStartPageToken(): Promise<string>;
    listChanges(pageToken: string): Promise<DriveChangeList>;
    /** Raw bytes via files.get?alt=media. */
    download(fileId: string): Promise<Uint8Array>;
    /** Google-native files have no bytes; export converts on Google's side. */
    exportFile(fileId: string, mimeType: string): Promise<Uint8Array>;
}
export interface DriveClientOptions {
    readonly accessToken: string;
    readonly fetch?: FetchLike;
    /** Retry attempts for rate limits / 5xx. */
    readonly maxAttempts?: number;
    /** Injectable for tests; defaults to real setTimeout. */
    readonly sleep?: (ms: number) => Promise<void>;
}
export declare function createDriveClient(options: DriveClientOptions): DriveClient;
//# sourceMappingURL=client.d.ts.map