/**
 * The Microsoft 365 sink: what a synced OneDrive or SharePoint file becomes.
 * Its identity is the connection plus `driveId:itemId`; the metadata it
 * writes is what "Open in OneDrive", the deleted-here record and a re-picked
 * folder all read back; a changed fingerprint makes a new version of the
 * same document; and a file deleted here after the run began is refused
 * before anything is uploaded.
 */

jest.mock("~/env", () => ({ env: { server: { APP_PUBLIC_URL: undefined } } }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("@launchstack/llm/embeddings", () => ({ resolveIngestIndexKey: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));
jest.mock("~/server/workspace/ownership", () => ({ applyDocumentCreationDefaults: jest.fn() }));
jest.mock("~/server/services/connectors/deleted-items", () => ({
    isSourceDeleted: jest.fn(),
}));

const mockUpdateSet = jest.fn();
const mockUpdateWhere = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        update: () => ({
            set: (values: unknown) => {
                mockUpdateSet(values);
                return { where: mockUpdateWhere };
            },
        }),
    },
}));

import { SourceDeletedError, type KnowledgeItem } from "@launchstack/pipelines/connectors";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

import { uploadFile } from "~/lib/storage";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "~/server/services/document-creation";
import { isSourceDeleted } from "~/server/services/connectors/deleted-items";
import {
    createMicrosoft365Sink,
    MICROSOFT_365_CATEGORY,
} from "~/server/services/connectors/microsoft-365/sink";
import { applyDocumentCreationDefaults } from "~/server/workspace/ownership";

const mockUploadFile = uploadFile as jest.Mock;

const DRIVE = "b!clients-documents";
const SOURCE = `${DRIVE}:01PBCLIST`;
const WEB_URL = "https://contoso.sharepoint.com/sites/Clients/Shared%20Documents/PBC%20list.xlsx";

function item(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
    return {
        sourceId: SOURCE,
        connectorId: "microsoft-365",
        title: "PBC list (final).xlsx",
        kind: "microsoft-365-file",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: 12,
        modifiedAt: "2026-10-01T00:00:00.000Z",
        location: { origin: WEB_URL, relativePath: "Brightwater/PBC list (final).xlsx" },
        metadata: {
            driveId: DRIVE,
            itemId: "01PBCLIST",
            webUrl: WEB_URL,
            parentPath: "/Brightwater",
            pickedRoot: `${DRIVE}:01BRIGHTWATER`,
            folderPath: ["Requests"],
            graphMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        content: new Uint8Array([1, 2, 3]),
        contentHash: 'ctag:"c:{01PBCLIST},2"',
        ...overrides,
    };
}

const context = { companyId: 7n, connectionId: 3, userId: "user_abc" };

beforeEach(() => {
    jest.clearAllMocks();
    (resolveIngestIndexKey as jest.Mock).mockResolvedValue("openai-small");
    mockUploadFile.mockResolvedValue({ url: "https://blob.test/pbc.xlsx" });
    (findDocumentByCreationKey as jest.Mock).mockResolvedValue(null);
    jest.mocked(isSourceDeleted).mockResolvedValue(false);
    (createDocumentLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 21,
        jobId: "job-1",
        created: true,
    });
    (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 22,
        jobId: "job-2",
    });
});

describe("createMicrosoft365Sink: a file seen for the first time", () => {
    it("is keyed by the connection and the file's drive and item ids", async () => {
        const sink = await createMicrosoft365Sink(context);
        await sink.store(item());

        expect(findDocumentByCreationKey).toHaveBeenCalledWith(
            7n,
            `connector:microsoft-365:3:${SOURCE}`
        );
        expect(createDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                creationKey: `connector:microsoft-365:3:${SOURCE}`,
                category: MICROSOFT_365_CATEGORY,
                title: "PBC list (final).xlsx",
            })
        );
    });

    it("records where it came from, so it can be opened, re-picked and remembered when deleted", async () => {
        const sink = await createMicrosoft365Sink(context);
        await sink.store(item());

        const call = (createDocumentLifecycle as jest.Mock).mock.calls[0]![0] as {
            ocrMetadata: Record<string, unknown>;
            processing: { originalFilename: string };
        };
        expect(call.ocrMetadata).toMatchObject({
            connector: "microsoft-365",
            connectionId: "3",
            sourceId: SOURCE,
            driveId: DRIVE,
            itemId: "01PBCLIST",
            webUrl: WEB_URL,
            pickedRootId: `${DRIVE}:01BRIGHTWATER`,
            folderPath: ["Requests"],
            contentHash: 'ctag:"c:{01PBCLIST},2"',
        });
        // The name keeps its extension: the ingestion router picks its adapter from it.
        expect(call.processing.originalFilename).toBe("PBC-list-final-.xlsx");
    });

    it("stamps the workspace on the upload, and attributes it to whoever picked it", async () => {
        const owner = { companyId: 7n, userPk: 5n, authUserId: "user_picker" };
        const sink = await createMicrosoft365Sink({
            ...context,
            place: () => Promise.resolve({ category: "Clients/Brightwater", owner }),
        });
        await sink.store(item());

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user_picker", companyId: 7n })
        );
        expect(createDocumentLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({ category: "Clients/Brightwater", userId: "user_picker" })
        );
        expect(applyDocumentCreationDefaults).toHaveBeenCalledWith(expect.anything(), owner, [
            { id: 11, category: "Clients/Brightwater" },
        ]);
    });
});

describe("createMicrosoft365Sink: a file that changed", () => {
    beforeEach(() => {
        (findDocumentByCreationKey as jest.Mock).mockResolvedValue({
            id: 11,
            category: "Moved/By someone",
            ocrMetadata: { contentHash: 'ctag:"c:{01PBCLIST},1"' },
        });
    });

    it("reports the fingerprint it stored last time", async () => {
        const sink = await createMicrosoft365Sink(context);
        await expect(sink.lastSyncedHash!(item())).resolves.toBe('ctag:"c:{01PBCLIST},1"');
    });

    it("adds a version to the same document, where the document is now", async () => {
        const place = jest.fn();
        const sink = await createMicrosoft365Sink({ ...context, place });
        const result = await sink.store(item());

        expect(result).toMatchObject({ documentId: 11, revised: true });
        expect(createDocumentLifecycle).not.toHaveBeenCalled();
        // Someone moved it: it is not placed again.
        expect(place).not.toHaveBeenCalled();
        expect(createDocumentVersionLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 11,
                category: "Moved/By someone",
                creationKey: `connector:microsoft-365:3:${SOURCE}:v:ctag:"c:{01PBCLIST},2"`,
            })
        );
        // The new fingerprint is written back, or every run would re-upload it.
        expect(mockUpdateSet).toHaveBeenCalledWith({
            ocrMetadata: expect.objectContaining({ contentHash: 'ctag:"c:{01PBCLIST},2"' }),
        });
    });

    it("doesn't ask whether it was deleted here: it still has its document", async () => {
        const sink = await createMicrosoft365Sink(context);
        await sink.store(item());
        expect(isSourceDeleted).not.toHaveBeenCalled();
    });
});

describe("createMicrosoft365Sink: deleted here", () => {
    it("refuses a file deleted here after the run began, before uploading anything", async () => {
        jest.mocked(isSourceDeleted).mockResolvedValue(true);
        const sink = await createMicrosoft365Sink(context);

        await expect(sink.store(item())).rejects.toBeInstanceOf(SourceDeletedError);
        expect(isSourceDeleted).toHaveBeenCalledWith(3, SOURCE);
        expect(mockUploadFile).not.toHaveBeenCalled();
        expect(createDocumentLifecycle).not.toHaveBeenCalled();
    });
});
