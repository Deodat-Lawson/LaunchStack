import type * as DrizzlePgCore from "drizzle-orm/pg-core";
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { PATCH } from "~/app/api/documents/[id]/route";
import {
    GET as listVersions,
    POST as createVersion,
} from "~/app/api/documents/[id]/versions/route";
import { DELETE as deleteVersion } from "~/app/api/documents/[id]/versions/[versionId]/route";
import { POST as revertVersion } from "~/app/api/documents/[id]/versions/[versionId]/revert/route";
import { DELETE as deleteDocument } from "~/app/api/deleteDocument/route";
import { DELETE as deleteBatch } from "~/app/api/documents/batchDelete/route";
import { POST as openDrive } from "~/app/api/documents/[id]/google-docs/open/route";
import { POST as syncDrive } from "~/app/api/documents/[id]/google-docs/sync/route";
import { POST as unlinkDrive } from "~/app/api/documents/[id]/google-docs/unlink/route";
import { GET as driveStatus } from "~/app/api/documents/[id]/google-docs/status/route";
import { PUT as setAccess } from "~/app/api/workspace/documents/[documentId]/access/route";
import { PATCH as renameCategory } from "~/app/api/Categories/[id]/route";
import { PATCH as renameFolderRoute, DELETE as deleteFolderRoute } from "~/app/api/folders/route";
import { POST as applyWordEdits } from "~/app/api/documents/adeu/apply/route";
import { callNoteDocumentMarker, isCallNoteDocument } from "~/lib/call-note-document";
import { fetchFile } from "~/lib/storage";
import { db as mockDb } from "~/server/db";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint) => ({ op: "scoped", companyId }),
}));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { strict: {}, standard: {}, permissive: {} },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({
    deleteFileByUrl: jest.fn(),
    fetchFile: jest.fn(),
    uploadFile: jest.fn(),
}));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));
jest.mock("~/server/services/document-delete", () => ({
    deleteDocumentCore: jest.fn(),
    deleteDocumentBlobs: jest.fn(),
}));
jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    canEditFolder: jest.fn().mockResolvedValue(true),
}));
jest.mock("~/server/services/internal-file-ref", () => ({
    authorizeInternalFileRef: jest.fn().mockResolvedValue(null),
    UploadAuthorizationError: class extends Error {},
}));
jest.mock("@launchstack/conversion/ocr/config", () => ({
    getOcrConfig: () => ({ defaultProvider: "DOCLING" }),
}));
jest.mock("@launchstack/conversion/ocr/trigger", () => ({ parseProvider: () => undefined }));
jest.mock("@launchstack/editing", () => ({
    acceptAllChanges: jest.fn(),
    processDocumentBatchDetailed: jest.fn(),
    rejectAllChanges: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    GoogleAuthError: class extends Error {},
    GoogleDriveError: class extends Error {},
}));
jest.mock("~/server/services/google-drive/config", () => ({
    isDriveLinkingEnabled: () => true,
    GoogleDriveConfigError: class extends Error {},
}));
jest.mock("~/server/services/google-drive/connections", () => ({
    GoogleNotConnectedError: class extends Error {},
    getActiveGoogleConnection: jest.fn().mockResolvedValue(null),
}));
jest.mock("~/server/services/google-drive/links", () => ({
    DriveLinkError: class extends Error {},
    getActiveDriveLink: jest.fn().mockResolvedValue(null),
    getDriveLinkForDocument: jest.fn().mockResolvedValue(null),
    isDriveLinkableDocument: () => true,
    linkDocumentToDrive: jest.fn(),
}));
jest.mock("~/server/services/google-drive/sync", () => ({
    pullDriveLink: jest.fn(),
    unlinkDocument: jest.fn(),
}));
jest.mock("~/server/workspace/folder-access", () => ({
    folderGrantRows: jest.fn(),
    folderRestricted: jest.fn(),
}));
jest.mock("~/server/workspace/grants", () => ({ callerGroupIds: jest.fn() }));
jest.mock("~/server/db", () => ({
    db: { select: jest.fn(), update: jest.fn(), delete: jest.fn(), transaction: jest.fn() },
}));
jest.mock("~/server/db/schema", () => ({
    documentSettings: { documentId: "documentSettings.documentId", restricted: "restricted" },
    documentGrants: { documentId: "documentGrants.documentId" },
    folderSettings: { companyId: "folderSettings.companyId", visibility: "visibility" },
    users: { id: "users.id" },
}));
jest.mock("@launchstack/store/schema", () => {
    const { bigint, integer, jsonb, pgTable, text } =
        jest.requireActual<typeof DrizzlePgCore>("drizzle-orm/pg-core");
    return {
        document: pgTable("pdr_ai_v2_document", {
            id: integer("id"),
            title: text("title"),
            category: text("category"),
            ocrMetadata: jsonb("ocr_metadata"),
            companyId: bigint("company_id", { mode: "bigint" }),
        }),
        category: { id: "category.id", name: "category.name", companyId: "category.companyId" },
        documentVersions: { id: "documentVersions.id", documentId: "documentVersions.documentId" },
    };
});
jest.mock("drizzle-orm", () => ({
    sql: jest.requireActual("drizzle-orm").sql,
    getTableName: jest.requireActual("drizzle-orm").getTableName,
    getTableColumns: jest.requireActual("drizzle-orm").getTableColumns,
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
    inArray: (column: unknown, values: unknown[]) => ({ op: "in", column, values }),
    desc: (column: unknown) => ({ op: "desc", column }),
}));

const mockSelect = mockDb.select as jest.Mock;
const mockUpdate = mockDb.update as jest.Mock;
const mockTransaction = mockDb.transaction as jest.Mock;
const mockVersionLifecycle = createDocumentVersionLifecycle as jest.Mock;

const context = { params: Promise.resolve({ id: "55", versionId: "77" }) };
const accessContext = { params: Promise.resolve({ documentId: "55" }) };
const original = {
    id: 55,
    companyId: BigInt(10),
    title: "Release review",
    category: "Calls",
    fileType: "text/markdown",
    mimeType: "text/markdown",
    currentVersionId: BigInt(88),
    url: "https://storage.example/review.md",
};

function request(path: string, method: string, body?: unknown): Request {
    return new Request(`https://app.example${path}`, {
        method,
        ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
}

function selectRows(rows: unknown[]): void {
    const result = Object.assign(Promise.resolve(rows), {
        limit: jest.fn().mockResolvedValue(rows),
        orderBy: jest.fn().mockResolvedValue(rows),
    });
    mockSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue(result) }),
    });
}

const mutations = [
    {
        name: "rename",
        run: () =>
            PATCH(request("/api/documents/55", "PATCH", { title: "Different title" }), context),
    },
    {
        name: "move or change category",
        run: () => PATCH(request("/api/documents/55", "PATCH", { category: "Archive" }), context),
    },
    {
        name: "upload a new version",
        run: () =>
            createVersion(
                request("/api/documents/55/versions", "POST", {
                    documentUrl: "https://storage.example/replacement.md",
                    mimeType: "text/markdown",
                }),
                context
            ),
    },
    {
        name: "delete the document",
        run: () => deleteDocument(request("/api/deleteDocument", "DELETE", { docId: "55" })),
    },
    {
        name: "delete in a batch",
        run: () => deleteBatch(request("/api/documents/batchDelete", "DELETE", { docIds: [55] })),
    },
    {
        name: "delete a version",
        run: () => deleteVersion(request("/api/documents/55/versions/77", "DELETE"), context),
    },
    {
        name: "restore a version",
        run: () => revertVersion(request("/api/documents/55/versions/77/revert", "POST"), context),
    },
    {
        name: "link to Google Drive",
        run: () => openDrive(request("/api/documents/55/google-docs/open", "POST"), context),
    },
    {
        name: "pull Google Drive edits",
        run: () => syncDrive(request("/api/documents/55/google-docs/sync", "POST"), context),
    },
    {
        name: "unlink and pull Google Drive edits",
        run: () => unlinkDrive(request("/api/documents/55/google-docs/unlink", "POST"), context),
    },
    {
        name: "restrict access",
        run: () =>
            setAccess(
                request("/api/workspace/documents/55/access", "PUT", {
                    restricted: true,
                    grants: [],
                }),
                accessContext
            ),
    },
    {
        name: "apply Word content edits to a Call Note with a .docx title",
        run: () => {
            selectRows([
                {
                    ...original,
                    title: "Release review.docx",
                    ocrMetadata: callNoteDocumentMarker({ callId: "call-review" }),
                },
            ]);
            return applyWordEdits(
                request("/api/documents/adeu/apply", "POST", {
                    documentId: 55,
                    resolveAll: "accept",
                })
            );
        },
    },
];

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: BigInt(10) }),
    });
    selectRows([{ ...original, ocrMetadata: callNoteDocumentMarker({ callId: "call-review" }) }]);
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(mockDb)
    );
});

describe("Call Note document mutation ownership", () => {
    it.each(mutations)("refuses to $name through a generic document API", async ({ run }) => {
        const response = await run();

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual(
            expect.objectContaining({ error: "Call Note documents are managed from Calls" })
        );
        expect(mockDb.update).not.toHaveBeenCalled();
        expect(mockDb.delete).not.toHaveBeenCalled();
        expect(mockDb.transaction).not.toHaveBeenCalled();
        expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
        expect(deleteDocumentCore).not.toHaveBeenCalled();
        expect(fetchFile).not.toHaveBeenCalled();
    });

    it.each(mutations)(
        "refuses to $name when only the Call's indexed reference identifies the document",
        async ({ run }) => {
            selectRows([{ ...original, ocrMetadata: null, indexedCallNote: true }]);

            const response = await run();

            expect(response.status).toBe(409);
            expect(await response.json()).toEqual(
                expect.objectContaining({ error: "Call Note documents are managed from Calls" })
            );
            expect(mockDb.update).not.toHaveBeenCalled();
            expect(mockDb.delete).not.toHaveBeenCalled();
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(createDocumentVersionLifecycle).not.toHaveBeenCalled();
            expect(deleteDocumentCore).not.toHaveBeenCalled();
            expect(fetchFile).not.toHaveBeenCalled();
        }
    );

    it("rejects the entire mixed deletion batch and names the managed document ids", async () => {
        selectRows([
            { ...original, ocrMetadata: callNoteDocumentMarker({ callId: "call-review" }) },
            { ...original, id: 56, title: "Uploaded notes", ocrMetadata: null },
        ]);

        const response = await deleteBatch(
            request("/api/documents/batchDelete", "DELETE", { docIds: [55, 56] })
        );

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
            success: false,
            error: "Call Note documents are managed from Calls",
            documentIds: [55],
        });
        expect(mockDb.transaction).not.toHaveBeenCalled();
        expect(deleteDocumentCore).not.toHaveBeenCalled();
    });

    it("still renames and moves an uploaded Markdown document in Calls", async () => {
        const stored = { ...original, ocrMetadata: null };
        selectRows([stored]);
        mockUpdate.mockReturnValue({
            set: (patch: Partial<typeof original>) => {
                Object.assign(stored, patch);
                return {
                    where: jest.fn().mockReturnValue({
                        returning: jest.fn().mockResolvedValue([stored]),
                    }),
                };
            },
        });

        const response = await PATCH(
            request("/api/documents/55", "PATCH", {
                title: " Edited upload ",
                category: " Archive / Research ",
            }),
            context
        );

        expect(response.status).toBe(200);
        expect(stored.title).toBe("Edited upload");
        expect(stored.category).toBe("Archive/Research");
    });

    it("still accepts a new Markdown version for an uploaded document", async () => {
        selectRows([{ ...original, ocrMetadata: { connector: "upload" } }]);
        mockVersionLifecycle.mockResolvedValue({
            version: { id: 99, versionNumber: 3 },
            job: { id: "job-upload" },
            eventIds: ["event-upload"],
        });

        const response = await createVersion(
            request("/api/documents/55/versions", "POST", {
                documentUrl: "https://storage.example/replacement.md",
                mimeType: "text/markdown",
            }),
            context
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual(expect.objectContaining({ success: true }));
    });

    it("still deletes an uploaded document in Calls", async () => {
        selectRows([{ ...original, ocrMetadata: null }]);
        jest.mocked(deleteDocumentCore).mockResolvedValue([]);

        const response = await deleteDocument(
            request("/api/deleteDocument", "DELETE", { docId: "55" })
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(expect.objectContaining({ success: true }));
    });

    it("preserves a 404 for a Call Note document outside the caller's scope", async () => {
        selectRows([]);

        const response = await PATCH(
            request("/api/documents/55", "PATCH", { title: "Different title" }),
            context
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Document not found" });
    });

    it("keeps version history and Google Drive status readable for a Call Note document", async () => {
        const from = jest.fn();
        mockSelect.mockReturnValue({ from });
        from.mockReturnValueOnce({
            where: jest
                .fn()
                .mockResolvedValue([
                    { ...original, ocrMetadata: callNoteDocumentMarker({ callId: "call-review" }) },
                ]),
        });
        from.mockReturnValueOnce({
            where: jest.fn().mockReturnValue({
                orderBy: jest
                    .fn()
                    .mockResolvedValue([
                        { id: 88, versionNumber: 2, fileSize: 120, mimeType: "text/markdown" },
                    ]),
            }),
        });

        const versions = await listVersions(request("/api/documents/55/versions", "GET"), context);
        expect(versions.status).toBe(200);
        expect(await versions.json()).toEqual(
            expect.objectContaining({
                versions: [expect.objectContaining({ id: 88, isCurrent: true })],
            })
        );

        selectRows([
            { ...original, ocrMetadata: callNoteDocumentMarker({ callId: "call-review" }) },
        ]);
        const status = await driveStatus(
            request("/api/documents/55/google-docs/status", "GET"),
            context
        );
        expect(status.status).toBe(200);
        expect(await status.json()).toEqual(
            expect.objectContaining({ success: true, connected: false, link: null })
        );
    });
});

describe("Call Note provenance", () => {
    it("recognizes durable metadata or a Call's indexed document reference", () => {
        expect(
            isCallNoteDocument({
                ocrMetadata: { callNote: { callId: "call-review" }, confidence: 0.98 },
            })
        ).toBe(true);
        expect(isCallNoteDocument({ ocrMetadata: null, indexedCallNote: true })).toBe(true);
        expect(isCallNoteDocument({ ocrMetadata: null, indexedCallNote: false })).toBe(false);
        for (const metadata of [
            null,
            [],
            "callNote",
            {},
            { callNote: null },
            { callNote: {} },
            { callNote: { callId: "" } },
        ]) {
            expect(isCallNoteDocument({ ocrMetadata: metadata })).toBe(false);
        }
    });
});

describe("Calls collection ownership", () => {
    it.each([
        {
            name: "rename the category",
            messageField: "error",
            run: () =>
                renameCategory(
                    request("/api/Categories/55", "PATCH", { name: "Archive" }),
                    context
                ),
        },
        {
            name: "rename the folder",
            messageField: "message",
            run: () =>
                renameFolderRoute(
                    request("/api/folders", "PATCH", { path: "Calls", newPath: "Archive" })
                ),
        },
        {
            name: "move the folder",
            messageField: "message",
            run: () =>
                renameFolderRoute(
                    request("/api/folders", "PATCH", { path: "Calls", newPath: "Archive/Calls" })
                ),
        },
        {
            name: "delete the folder",
            messageField: "message",
            run: () => deleteFolderRoute(request("/api/folders", "DELETE", { path: " Calls/ " })),
        },
    ])(
        "refuses to $name without cascading into indexed documents",
        async ({ run, messageField }) => {
            selectRows([{ id: 55, name: "Calls" }]);

            const response = await run();

            expect(response.status).toBe(409);
            expect(await response.json()).toEqual(
                expect.objectContaining({ [messageField]: "Calls is managed by Call Notes" })
            );
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(mockDb.update).not.toHaveBeenCalled();
            expect(mockDb.delete).not.toHaveBeenCalled();
        }
    );
});
