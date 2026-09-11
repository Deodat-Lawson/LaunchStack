/**
 * Drive sync against a fake DriveClient and an in-memory sink: folder
 * recursion, fingerprint change detection without downloads, the changes-feed
 * dirty-check short-circuit, access-lost classification, caps, and deletion
 * reporting. No network, no database.
 */

import {
    DriveAccessError,
    DriveExportTooLargeError,
    syncGoogleDrive,
    type DriveChangeList,
    type DriveClient,
    type DriveFile,
} from "@launchstack/pipelines/connectors/google-drive";
import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";

const FOLDER_MIME = "application/vnd.google-apps.folder";

interface FakeDriveOptions {
    files: DriveFile[];
    /** Pages returned by listChanges, keyed by the incoming pageToken. */
    changes?: Record<string, DriveChangeList>;
    /** File ids that answer 403/404. */
    inaccessible?: string[];
    /** File ids whose export exceeds Google's cap. */
    exportTooLarge?: string[];
    startPageToken?: string;
}

interface FakeDrive extends DriveClient {
    readonly downloads: string[];
    readonly exports: string[];
}

function createFakeDrive(options: FakeDriveOptions): FakeDrive {
    const byId = new Map(options.files.map(file => [file.id, file]));
    const downloads: string[] = [];
    const exports: string[] = [];
    const inaccessible = new Set(options.inaccessible ?? []);

    function requireAccess(fileId: string): DriveFile {
        if (inaccessible.has(fileId)) throw new DriveAccessError(fileId, 404);
        const file = byId.get(fileId);
        if (!file) throw new DriveAccessError(fileId, 404);
        return file;
    }

    return {
        downloads,
        exports,
        async getFile(fileId) {
            return requireAccess(fileId);
        },
        async listChildren(folderId) {
            requireAccess(folderId);
            return {
                files: options.files.filter(
                    file => file.parents?.includes(folderId) && !file.trashed
                ),
            };
        },
        async getStartPageToken() {
            return options.startPageToken ?? "token-next";
        },
        async listChanges(pageToken) {
            return options.changes?.[pageToken] ?? { changes: [], newStartPageToken: pageToken };
        },
        async download(fileId) {
            requireAccess(fileId);
            downloads.push(fileId);
            return new TextEncoder().encode(`bytes:${fileId}`);
        },
        async exportFile(fileId, mimeType) {
            requireAccess(fileId);
            if (options.exportTooLarge?.includes(fileId)) {
                throw new DriveExportTooLargeError(fileId);
            }
            exports.push(`${fileId}:${mimeType}`);
            return new TextEncoder().encode(`export:${fileId}`);
        },
    };
}

interface RecordingSink extends KnowledgeSink {
    readonly stored: KnowledgeItem[];
    readonly hashes: Map<string, string>;
}

function createRecordingSink(): RecordingSink {
    const stored: KnowledgeItem[] = [];
    const hashes = new Map<string, string>();
    let documentId = 0;

    return {
        stored,
        hashes,
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            return hashes.get(item.sourceId) ?? null;
        },
        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            stored.push(item);
            hashes.set(item.sourceId, item.contentHash);
            documentId += 1;
            return {
                sourceId: item.sourceId,
                documentId,
                versionId: documentId,
                jobId: null,
                revised: false,
            };
        },
    };
}

function pdf(id: string, parents?: string[], overrides: Partial<DriveFile> = {}): DriveFile {
    return {
        id,
        name: `${id}.pdf`,
        mimeType: "application/pdf",
        size: "1000",
        md5Checksum: `md5-${id}`,
        modifiedTime: "2026-08-01T00:00:00Z",
        parents,
        ...overrides,
    };
}

describe("syncGoogleDrive", () => {
    it("imports picked files and folder contents recursively, deduplicated", async () => {
        const client = createFakeDrive({
            files: [
                { id: "root", name: "Docs", mimeType: FOLDER_MIME },
                { id: "sub", name: "Sub", mimeType: FOLDER_MIME, parents: ["root"] },
                pdf("a", ["root"]),
                pdf("b", ["sub"]),
                pdf("solo"),
            ],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [
                { fileId: "root", kind: "folder" },
                // Also picked directly — must not import twice.
                { fileId: "a", kind: "file" },
                { fileId: "solo", kind: "file" },
            ],
        });

        expect(report.dirty).toBe(true);
        expect(report.stored.map(entry => entry.sourceId).sort()).toEqual(["a", "b", "solo"]);
        expect(report.failed).toHaveLength(0);
        expect(report.nextStartPageToken).toBe("token-next");
    });

    it("skips unchanged files by fingerprint without downloading them", async () => {
        const files = [pdf("a"), pdf("b")];
        const sink = createRecordingSink();
        const picked = [
            { fileId: "a", kind: "file" as const },
            { fileId: "b", kind: "file" as const },
        ];

        await syncGoogleDrive({ client: createFakeDrive({ files }), sink, pickedItems: picked });

        // Second run: b changed, a did not.
        const changed = [files[0]!, { ...files[1]!, md5Checksum: "md5-b-v2" }];
        const client = createFakeDrive({ files: changed });
        const report = await syncGoogleDrive({ client, sink, pickedItems: picked });

        expect(report.stored.map(entry => entry.sourceId)).toEqual(["b"]);
        expect(report.skipped).toEqual([{ sourceId: "a", reason: "unchanged" }]);
        expect(client.downloads).toEqual(["b"]);
    });

    it("short-circuits on an empty changes feed without discovering anything", async () => {
        const client = createFakeDrive({
            files: [pdf("a")],
            changes: { "cursor-1": { changes: [], newStartPageToken: "cursor-2" } },
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "a", kind: "file" }],
            startPageToken: "cursor-1",
        });

        expect(report.dirty).toBe(false);
        expect(report.discovered).toBe(0);
        expect(report.nextStartPageToken).toBe("cursor-2");
        expect(client.downloads).toHaveLength(0);
    });

    it("runs a full sync when the changes feed has entries", async () => {
        const client = createFakeDrive({
            files: [pdf("a")],
            changes: {
                "cursor-1": {
                    changes: [{ fileId: "a" }],
                    newStartPageToken: "cursor-2",
                },
            },
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "a", kind: "file" }],
            startPageToken: "cursor-1",
        });

        expect(report.dirty).toBe(true);
        expect(report.stored.map(entry => entry.sourceId)).toEqual(["a"]);
    });

    it("exports Google-native files instead of downloading them", async () => {
        const client = createFakeDrive({
            files: [
                {
                    id: "doc",
                    name: "Spec",
                    mimeType: "application/vnd.google-apps.document",
                    headRevisionId: "rev-1",
                },
            ],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "doc", kind: "file" }],
        });

        expect(client.exports).toEqual(["doc:text/markdown"]);
        expect(report.stored[0]?.sourceId).toBe("doc");
        expect(sink.stored[0]?.mimeType).toBe("text/markdown");
        expect(sink.stored[0]?.contentHash).toBe("rev:rev-1");
    });

    it("reports inaccessible files as accessLost, not failures", async () => {
        const client = createFakeDrive({
            files: [pdf("a")],
            inaccessible: ["gone"],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [
                { fileId: "a", kind: "file" },
                { fileId: "gone", kind: "file" },
            ],
        });

        expect(report.accessLost).toEqual(["gone"]);
        expect(report.failed).toHaveLength(0);
        expect(report.stored.map(entry => entry.sourceId)).toEqual(["a"]);
    });

    it("turns an export-size-cap error into a too-large skip", async () => {
        const client = createFakeDrive({
            files: [
                {
                    id: "huge",
                    name: "Huge deck",
                    mimeType: "application/vnd.google-apps.presentation",
                    headRevisionId: "rev-9",
                },
            ],
            exportTooLarge: ["huge"],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "huge", kind: "file" }],
        });

        expect(report.stored).toHaveLength(0);
        expect(report.skipped).toContainEqual(
            expect.objectContaining({ sourceId: "huge", reason: "too-large" })
        );
    });

    it("skips oversized and unsupported files with reasons", async () => {
        const client = createFakeDrive({
            files: [
                pdf("big", undefined, { size: String(200 * 1024 * 1024) }),
                {
                    id: "form",
                    name: "Survey",
                    mimeType: "application/vnd.google-apps.form",
                },
            ],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [
                { fileId: "big", kind: "file" },
                { fileId: "form", kind: "file" },
            ],
        });

        expect(report.stored).toHaveLength(0);
        expect(report.skipped).toContainEqual(
            expect.objectContaining({ sourceId: "big", reason: "too-large" })
        );
        expect(report.skipped).toContainEqual(
            expect.objectContaining({ sourceId: "form", reason: "excluded" })
        );
    });

    it("resolves shortcuts to their targets", async () => {
        const client = createFakeDrive({
            files: [
                {
                    id: "cut",
                    name: "Shortcut",
                    mimeType: "application/vnd.google-apps.shortcut",
                    shortcutDetails: { targetId: "real" },
                },
                pdf("real"),
            ],
        });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "cut", kind: "file" }],
        });

        expect(report.stored.map(entry => entry.sourceId)).toEqual(["real"]);
    });

    it("reports previously-known files that vanished as missing", async () => {
        const client = createFakeDrive({ files: [pdf("a")] });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "a", kind: "file" }],
            knownSourceIds: ["a", "deleted-file"],
        });

        expect(report.missingSourceIds).toEqual(["deleted-file"]);
    });

    it("stops at maxItems and marks the report truncated", async () => {
        const files = [
            { id: "root", name: "Docs", mimeType: FOLDER_MIME },
            ...Array.from({ length: 5 }, (_, index) => pdf(`f${index}`, ["root"])),
        ];
        const client = createFakeDrive({ files });
        const sink = createRecordingSink();

        const report = await syncGoogleDrive({
            client,
            sink,
            pickedItems: [{ fileId: "root", kind: "folder" }],
            maxItems: 3,
        });

        expect(report.truncated).toBe(true);
        expect(report.stored).toHaveLength(3);
    });

    it("force re-stores unchanged files", async () => {
        const files = [pdf("a")];
        const sink = createRecordingSink();
        const picked = [{ fileId: "a", kind: "file" as const }];

        await syncGoogleDrive({ client: createFakeDrive({ files }), sink, pickedItems: picked });
        const report = await syncGoogleDrive({
            client: createFakeDrive({ files }),
            sink,
            pickedItems: picked,
            force: true,
        });

        expect(report.stored.map(entry => entry.sourceId)).toEqual(["a"]);
    });
});
