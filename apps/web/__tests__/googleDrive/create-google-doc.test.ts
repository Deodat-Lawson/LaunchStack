/**
 * Create → Google Doc (the inverse of linking): Drive holds the original.
 *
 * The invariants worth pinning are the ones a reader cannot infer from the
 * happy path — the conversion upload, the `origin: "created"` link that spares
 * the file a permanent fidelity warning, and the orphan cleanup that keeps a
 * failure from leaving a stray file in someone's Drive.
 */

const mockEnv = {
    server: {
        APP_PUBLIC_URL: "https://app.test" as string | undefined,
        GOOGLE_DOCS_EDITING_ENABLED: "true" as string | undefined,
        GOOGLE_OAUTH_CLIENT_ID: "cid" as string | undefined,
        GOOGLE_OAUTH_CLIENT_SECRET: "sec" as string | undefined,
        GOOGLE_OAUTH_REDIRECT_URL: undefined as string | undefined,
        GOOGLE_DOCS_SETTLE_MINUTES: "10" as string | undefined,
    },
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
// connections.ts reaches the engine transitively; stubbing it keeps the
// requireActual below from booting the RAG stack (and reading env too early).
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn(), fetchFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/services/google-drive/connections", () => ({
    ...jest.requireActual("~/server/services/google-drive/connections"),
    getActiveGoogleConnection: jest.fn(),
    getAccessTokenForConnection: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    ensureFolder: jest.fn(),
    createFileMultipart: jest.fn(),
    exportFileContent: jest.fn(),
    trashFile: jest.fn(),
}));

const mockSelectResults: unknown[][] = [];
function mockChain(): Record<string, unknown> {
    const target: Record<string, unknown> = {};
    const proxy: Record<string, unknown> = new Proxy(target, {
        get(_t, prop) {
            if (prop === "then") {
                const result = mockSelectResults.shift() ?? [];
                return (resolve: (v: unknown) => void) => resolve(result);
            }
            return () => proxy;
        },
    });
    return proxy;
}
const mockInsertValues: Array<Record<string, unknown>> = [];
jest.mock("~/server/db", () => ({
    db: {
        select: () => mockChain(),
        insert: () => ({
            values: (values: Record<string, unknown>) => {
                mockInsertValues.push(values);
                return { onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) };
            },
        }),
    },
}));

import {
    GOOGLE_DOC_MIME,
    createFileMultipart,
    ensureFolder,
    exportFileContent,
    trashFile,
} from "@launchstack/google-drive";

import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";
import {
    getAccessTokenForConnection,
    getActiveGoogleConnection,
    GoogleNotConnectedError,
} from "~/server/services/google-drive/connections";
import { createGoogleDocDocument } from "~/server/services/google-drive/create";

const mockEnsureFolder = ensureFolder as jest.Mock;
const mockCreateFile = createFileMultipart as jest.Mock;
const mockExport = exportFileContent as jest.Mock;
const mockTrash = trashFile as jest.Mock;
const mockUpload = uploadFile as jest.Mock;
const mockProcessUpload = processDocumentUpload as jest.Mock;
const mockConnection = getActiveGoogleConnection as jest.Mock;
const mockToken = getAccessTokenForConnection as jest.Mock;

const CONNECTION = { id: 2, providerAccountEmail: "team@example.com", status: "active" };

const PARAMS = {
    companyId: BigInt(9),
    authUserId: "auth-1",
    userPk: BigInt(3),
    title: "Q3 Planning",
    category: "Strategy",
    requestUrl: "https://app.test/api/google-docs",
};

function happyPath() {
    mockConnection.mockResolvedValue(CONNECTION);
    mockToken.mockResolvedValue("at");
    mockEnsureFolder.mockResolvedValue("folder1");
    mockCreateFile.mockResolvedValue({
        id: "doc1",
        mimeType: GOOGLE_DOC_MIME,
        version: "1",
        webViewLink: "https://docs.google.com/document/d/doc1/edit",
    });
    mockExport.mockResolvedValue(Buffer.from("DOCXBYTES"));
    mockUpload.mockResolvedValue({ url: "/api/files/9", provider: "database" });
    mockProcessUpload.mockResolvedValue({ document: { id: 51 } });
    mockSelectResults.push([{ currentVersionId: BigInt(70) }]);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectResults.length = 0;
    mockInsertValues.length = 0;
    mockEnv.server.GOOGLE_DOCS_EDITING_ENABLED = "true";
});

describe("createGoogleDocDocument", () => {
    it("creates a native Doc by asking Drive to convert an HTML seed", async () => {
        happyPath();

        const result = await createGoogleDocDocument(PARAMS);

        expect(result).toEqual({
            documentId: 51,
            driveFileId: "doc1",
            url: "https://docs.google.com/document/d/doc1/edit",
        });

        const createArgs = mockCreateFile.mock.calls[0]![0] as Record<string, unknown>;
        expect(createArgs.targetMimeType).toBe(GOOGLE_DOC_MIME);
        expect(createArgs.mimeType).toBe("text/html");
        expect(createArgs.parents).toEqual(["folder1"]);
        // The title is seeded as a heading so the Doc is not blank and the
        // chunker has real text to work with.
        expect((createArgs.data as Buffer).toString("utf8")).toContain("<h1>Q3 Planning</h1>");
    });

    it("indexes the exported .docx, not the HTML it uploaded", async () => {
        happyPath();

        await createGoogleDocDocument(PARAMS);

        expect(mockExport).toHaveBeenCalledWith(
            expect.objectContaining({
                fileId: "doc1",
                mimeType: expect.stringContaining("wordprocessingml"),
            })
        );
        const uploadArgs = mockUpload.mock.calls[0]![0] as Record<string, unknown>;
        expect((uploadArgs.data as Buffer).toString("utf8")).toBe("DOCXBYTES");
        expect(uploadArgs.filename).toBe("Q3 Planning.docx");
        expect(mockProcessUpload).toHaveBeenCalledWith(
            expect.objectContaining({
                creationKey: "gdocs:create:doc1",
                category: "Strategy",
                documentName: "Q3 Planning",
            })
        );
    });

    it("records the link as created, with the revision marker pre-seeded", async () => {
        happyPath();

        await createGoogleDocDocument(PARAMS);

        expect(mockInsertValues[0]).toMatchObject({
            documentId: BigInt(51),
            driveFileId: "doc1",
            origin: "created",
            status: "linked",
            fidelityWarning: false,
            // Native Docs carry no md5; the version counter is the gate, and
            // seeding it stops the reconciler re-exporting identical content.
            lastSyncedMd5: null,
            lastSyncedRevisionId: "v1",
            baseVersionId: BigInt(70),
        });
    });

    it("falls back to a default title when the caller sends blank", async () => {
        happyPath();

        await createGoogleDocDocument({ ...PARAMS, title: "   " });

        expect(mockCreateFile.mock.calls[0]![0]).toMatchObject({ name: "Untitled document" });
    });

    it("trashes the Drive file when a later step fails", async () => {
        happyPath();
        mockExport.mockRejectedValue(new Error("export exploded"));

        await expect(createGoogleDocDocument(PARAMS)).rejects.toThrow("export exploded");

        // A create that half-succeeded must not leave a file the user never
        // asked for and cannot trace back to us.
        expect(mockTrash).toHaveBeenCalledWith(expect.objectContaining({ fileId: "doc1" }));
    });

    it("refuses before touching Drive when no Google account is connected", async () => {
        mockConnection.mockResolvedValue(null);

        await expect(createGoogleDocDocument(PARAMS)).rejects.toBeInstanceOf(
            GoogleNotConnectedError
        );
        expect(mockEnsureFolder).not.toHaveBeenCalled();
        expect(mockCreateFile).not.toHaveBeenCalled();
    });

    it("refuses when the feature flag is off", async () => {
        happyPath();
        mockEnv.server.GOOGLE_DOCS_EDITING_ENABLED = undefined;

        await expect(createGoogleDocDocument(PARAMS)).rejects.toMatchObject({
            status: 404,
            code: "feature_disabled",
        });
        expect(mockConnection).not.toHaveBeenCalled();
    });
});
