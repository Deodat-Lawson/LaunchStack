/**
 * Deleting a synced OneDrive or SharePoint document. The delete is
 * remembered against its connection (so the next sync leaves it out), with
 * the pick it came through (so picking that folder again brings it back).
 * A file picked on its own takes its pick with it; one that came through a
 * folder leaves the folder's pick alone. And a sync whose token Microsoft
 * rejected is a connection to reconnect, not a list of unreadable folders.
 */

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));

import { isListableDriveRow, syncedSourceOf } from "~/server/services/connectors/deleted-items";
import { deleteDocumentCore } from "~/server/services/document-delete";
import {
    reportCounts,
    tokenRejected,
} from "~/server/services/connectors/microsoft-365/sync-service";
import { connectorDeletedItem, microsoft365PickedItem } from "~/server/db/schema";

const DRIVE = "b!clients-documents";

function metadata(overrides: Record<string, unknown> = {}) {
    return {
        connector: "microsoft-365",
        connectionId: "3",
        sourceId: `${DRIVE}:01FILE`,
        driveId: DRIVE,
        itemId: "01FILE",
        pickedRootId: `${DRIVE}:01ROOM`,
        ...overrides,
    };
}

describe("syncedSourceOf", () => {
    it("reads a Microsoft 365 document's connection, file and pick", () => {
        expect(syncedSourceOf(metadata())).toEqual({
            connectionId: 3,
            sourceId: `${DRIVE}:01FILE`,
            pickedRootId: `${DRIVE}:01ROOM`,
        });
    });

    it("is nothing for an upload, or for a row without its ids", () => {
        expect(syncedSourceOf({ connector: "upload" })).toBeNull();
        expect(syncedSourceOf(metadata({ sourceId: undefined }))).toBeNull();
        expect(syncedSourceOf(metadata({ connectionId: "zero" }))).toBeNull();
    });

    it("lists a file that came through a folder, not one whose own pick went with it", () => {
        const base = { connectionId: 3, title: "t", deletedByUserPk: 1, deletedAt: new Date() };
        expect(
            isListableDriveRow({
                ...base,
                sourceId: `${DRIVE}:01FILE`,
                pickedRootId: `${DRIVE}:01ROOM`,
            })
        ).toBe(true);
        expect(
            isListableDriveRow({
                ...base,
                sourceId: `${DRIVE}:01FILE`,
                pickedRootId: `${DRIVE}:01FILE`,
            })
        ).toBe(false);
    });
});

/** A transaction that records which tables were written, and answers one select. */
function recordingTx(row: { title: string; metadata: unknown } | null) {
    const deletes: unknown[] = [];
    const inserts: { table: unknown; values: unknown }[] = [];
    const tx = {
        select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }) }),
        }),
        delete: (table: unknown) => {
            deletes.push(table);
            return { where: () => Promise.resolve() };
        },
        insert: (table: unknown) => ({
            values: (values: unknown) => {
                inserts.push({ table, values });
                return { onConflictDoUpdate: () => Promise.resolve() };
            },
        }),
    };
    return { tx: tx as unknown as Parameters<typeof deleteDocumentCore>[0], deletes, inserts };
}

describe("deleting a synced document", () => {
    it("remembers the delete with the pick it came through, and keeps the folder's pick", async () => {
        const { tx, deletes, inserts } = recordingTx({
            title: "PBC list.xlsx",
            metadata: metadata(),
        });
        await deleteDocumentCore(tx, 42, { deletedByUserPk: 9 });

        expect(inserts).toEqual([
            {
                table: connectorDeletedItem,
                values: {
                    connectionId: 3,
                    sourceId: `${DRIVE}:01FILE`,
                    pickedRootId: `${DRIVE}:01ROOM`,
                    title: "PBC list.xlsx",
                    deletedByUserPk: 9,
                },
            },
        ]);
        expect(deletes).not.toContain(microsoft365PickedItem);
    });

    it("ends the pick of a file that was picked on its own", async () => {
        const { tx, deletes, inserts } = recordingTx({
            title: "Deck.pdf",
            metadata: metadata({ pickedRootId: `${DRIVE}:01FILE` }),
        });
        await deleteDocumentCore(tx, 42);

        expect(deletes).toContain(microsoft365PickedItem);
        // Still remembered, so a picked folder that also reaches it leaves it out.
        expect(inserts).toHaveLength(1);
    });

    it("leaves Microsoft 365 picks alone when the document came from somewhere else", async () => {
        const { tx, deletes, inserts } = recordingTx({
            title: "Notes",
            metadata: { connector: "upload" },
        });
        await deleteDocumentCore(tx, 42);
        expect(deletes).not.toContain(microsoft365PickedItem);
        expect(inserts).toEqual([]);
    });
});

describe("what a run reports", () => {
    const report = {
        connectorId: "microsoft-365",
        startedAt: "",
        finishedAt: "",
        durationMs: 12,
        dirty: true,
        discovered: 4,
        stored: [{ sourceId: "a", documentId: 1, versionId: 1, jobId: "j", revised: false }],
        skipped: [
            { sourceId: "b", reason: "unchanged" as const },
            { sourceId: "c", reason: "unchanged" as const },
        ],
        failed: [],
        missingSourceIds: ["gone"],
        accessLost: [],
        emptyFolders: [`${DRIVE}:01EMPTY`],
        truncated: false,
    };

    it("keeps the counts Settings shows, and names the folders that came back empty", () => {
        expect(reportCounts(report)).toMatchObject({
            stored: 1,
            unchanged: 2,
            failed: 0,
            missing: 1,
            emptyFolders: [`${DRIVE}:01EMPTY`],
            truncated: false,
        });
    });

    it("tells a rejected token from a folder that merely couldn't be read", () => {
        expect(tokenRejected(report)).toBe(false);
        expect(
            tokenRejected({
                skipped: [
                    {
                        sourceId: "x",
                        reason: "unreadable",
                        detail: "Microsoft365AuthError: token expired",
                    },
                ],
            })
        ).toBe(true);
        expect(
            tokenRejected({
                skipped: [
                    {
                        sourceId: "x",
                        reason: "unreadable",
                        detail: "Microsoft365ApiError: server busy",
                    },
                ],
            })
        ).toBe(false);
    });
});
