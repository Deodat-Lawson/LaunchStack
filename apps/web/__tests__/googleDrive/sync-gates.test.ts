/**
 * The pull-sync gate ladder (Drive-Linked Files, Leg 3): every gate exists to
 * keep the per-sync cost proportional to the edit, and each one is asserted
 * here by what it must NOT do — no download on a revision match, no version
 * on identical bytes, no pull inside the settle window.
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
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn(), fetchFile: jest.fn() }));
jest.mock("~/server/services/detect-storage-type", () => ({
    toAbsoluteUrl: jest.fn((url: string, base: string) => new URL(url, base).toString()),
}));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));
jest.mock("~/server/services/google-drive/connections", () => ({
    ...jest.requireActual("~/server/services/google-drive/connections"),
    getAccessTokenForConnection: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    getFileMetadata: jest.fn(),
    downloadFileContent: jest.fn(),
    exportFileContent: jest.fn(),
    trashFile: jest.fn(),
}));

/**
 * Drizzle query builders are thenables; this stand-in lets any chain of
 * builder calls resolve to the next queued result when awaited.
 */
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
const mockUpdateCalls: Array<Record<string, unknown>> = [];
jest.mock("~/server/db", () => ({
    db: {
        select: () => mockChain(),
        update: () => ({
            set: (values: Record<string, unknown>) => {
                mockUpdateCalls.push(values);
                return { where: jest.fn().mockResolvedValue(undefined) };
            },
        }),
    },
}));

import {
    GOOGLE_DOC_MIME,
    GoogleAuthError,
    downloadFileContent,
    exportFileContent,
    getFileMetadata,
} from "@launchstack/google-drive";

import { uploadFile } from "~/lib/storage";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
import {
    isDriveLinkableDocument,
    linkedFilename,
    resolveCanonicalMime,
} from "~/server/services/google-drive/links";
import { pullDriveLink } from "~/server/services/google-drive/sync";
import type { ConnectorConnection, DocumentDriveLink } from "~/server/db/schema";

const mockGetMetadata = getFileMetadata as jest.Mock;
const mockDownload = downloadFileContent as jest.Mock;
const mockExport = exportFileContent as jest.Mock;
const mockToken = getAccessTokenForConnection as jest.Mock;
const mockUpload = uploadFile as jest.Mock;
const mockLifecycle = createDocumentVersionLifecycle as jest.Mock;

const HOUR = 60 * 60 * 1000;

function link(overrides: Partial<DocumentDriveLink> = {}): DocumentDriveLink {
    return {
        id: 1,
        documentId: BigInt(5),
        connectionId: BigInt(2),
        linkedByUserId: BigInt(3),
        driveFileId: "f1",
        driveWebViewLink: "https://docs.google.com/x",
        baseVersionId: BigInt(10),
        lastSyncedVersionId: null,
        lastSyncedRevisionId: "rev1",
        lastSyncedMd5: "md5a",
        status: "linked",
        fidelityWarning: false,
        lastCheckedAt: new Date(Date.now() - HOUR),
        lastSyncedAt: new Date(Date.now() - HOUR),
        lastError: null,
        createdAt: new Date(Date.now() - 2 * HOUR),
        updatedAt: null,
        ...overrides,
    };
}

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
    return {
        id: 2,
        companyId: BigInt(9),
        provider: "google-drive",
        providerAccountId: "sub-1",
        providerAccountEmail: "founder@example.com",
        grantedByUserId: BigInt(3),
        refreshTokenCiphertext: "ct",
        encryptionKeyVersion: 1,
        scopes: "drive.file",
        status: "active",
        lastRefreshError: null,
        createdAt: new Date(),
        updatedAt: null,
        ...overrides,
    };
}

const DOC_ROW = {
    id: 5,
    companyId: BigInt(9),
    title: "Contract",
    category: "Legal",
    mimeType: "application/pdf",
    fileType: "pdf",
};
const USER_ROW = { userId: "clerk_abc" };

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectResults.length = 0;
    mockUpdateCalls.length = 0;
    mockToken.mockResolvedValue("at");
});

describe("pull gates", () => {
    it("gate 1 — unchanged revision: no download, no version", async () => {
        mockSelectResults.push([connection()]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            headRevisionId: "rev1",
            md5Checksum: "md5a",
            trashed: false,
        });

        const outcome = await pullDriveLink(link());

        expect(outcome).toEqual({ kind: "noop", reason: "unchanged" });
        expect(mockDownload).not.toHaveBeenCalled();
        expect(mockLifecycle).not.toHaveBeenCalled();
    });

    it("gate 2 — revision churn with identical bytes: markers advance, no download", async () => {
        mockSelectResults.push([connection()]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            headRevisionId: "rev2",
            md5Checksum: "md5a",
            trashed: false,
        });

        const outcome = await pullDriveLink(link());

        expect(outcome).toEqual({ kind: "noop", reason: "identical_bytes" });
        expect(mockDownload).not.toHaveBeenCalled();
        expect(mockUpdateCalls.at(-1)).toMatchObject({ lastSyncedRevisionId: "rev2" });
    });

    it("gate 3 — inside the settle window: no pull until the file goes quiet", async () => {
        mockSelectResults.push([connection()]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            headRevisionId: "rev2",
            md5Checksum: "md5b",
            modifiedTime: new Date().toISOString(),
            trashed: false,
        });

        const outcome = await pullDriveLink(link());

        expect(outcome.kind).toBe("settling");
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it("a settled revision becomes exactly one idempotent version", async () => {
        mockSelectResults.push([connection()], [DOC_ROW], [USER_ROW]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            headRevisionId: "rev2",
            md5Checksum: "md5b",
            modifiedTime: new Date(Date.now() - HOUR).toISOString(),
            trashed: false,
        });
        mockDownload.mockResolvedValue(Buffer.from("new-bytes"));
        mockUpload.mockResolvedValue({ url: "/api/files/9" });
        mockLifecycle.mockResolvedValue({ versionId: 77, version: { versionNumber: 7 } });

        const outcome = await pullDriveLink(link());

        expect(outcome).toMatchObject({ kind: "synced", versionId: 77, versionNumber: 7 });
        expect(mockLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                creationKey: "gdrive:f1:rev2",
                mimeType: "application/pdf",
                processingUrl: "https://app.test/api/files/9",
                changelog: "Edited in Google Drive by founder@example.com",
                userId: "clerk_abc",
            })
        );
        expect(mockUpdateCalls.at(-1)).toMatchObject({
            lastSyncedRevisionId: "rev2",
            lastSyncedVersionId: BigInt(77),
            lastError: null,
        });
    });

    it("manual Sync now skips the settle gate, never the revision gates", async () => {
        mockSelectResults.push([connection()], [DOC_ROW], [USER_ROW]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            headRevisionId: "rev2",
            md5Checksum: "md5b",
            modifiedTime: new Date().toISOString(),
            trashed: false,
        });
        mockDownload.mockResolvedValue(Buffer.from("new-bytes"));
        mockUpload.mockResolvedValue({ url: "/api/files/9" });
        mockLifecycle.mockResolvedValue({ versionId: 78, version: { versionNumber: 8 } });

        const outcome = await pullDriveLink(link(), { force: true });
        expect(outcome.kind).toBe("synced");
    });

    it("a trashed Drive file orphans the link instead of erroring forever", async () => {
        mockSelectResults.push([connection()]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: "application/pdf",
            trashed: true,
        });

        const outcome = await pullDriveLink(link());

        expect(outcome).toEqual({ kind: "orphaned", detail: "trashed" });
        expect(mockUpdateCalls.at(-1)).toMatchObject({ status: "orphaned" });
    });

    it("a converted native Google Doc pulls via export with a fidelity flag", async () => {
        mockSelectResults.push([connection()], [DOC_ROW], [USER_ROW]);
        mockGetMetadata.mockResolvedValue({
            id: "f1",
            mimeType: GOOGLE_DOC_MIME,
            version: "42",
            modifiedTime: new Date(Date.now() - HOUR).toISOString(),
            trashed: false,
        });
        mockExport.mockResolvedValue(Buffer.from("exported"));
        mockUpload.mockResolvedValue({ url: "/api/files/9" });
        mockLifecycle.mockResolvedValue({ versionId: 79, version: { versionNumber: 9 } });

        const outcome = await pullDriveLink(link());

        expect(outcome).toMatchObject({ kind: "synced", fidelityWarning: true });
        expect(mockExport).toHaveBeenCalled();
        expect(mockDownload).not.toHaveBeenCalled();
        expect(mockLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({ creationKey: "gdrive:f1:v42" })
        );
        expect(mockUpdateCalls.at(-1)).toMatchObject({
            fidelityWarning: true,
            lastSyncedMd5: null,
        });
    });

    it("a revoked grant surfaces as auth_revoked, not a retry loop", async () => {
        mockSelectResults.push([connection()]);
        mockToken.mockRejectedValue(new GoogleAuthError(400, "invalid_grant", true));

        const outcome = await pullDriveLink(link());

        expect(outcome).toMatchObject({ kind: "auth_revoked" });
        expect(mockGetMetadata).not.toHaveBeenCalled();
    });

    it("a disconnected connection stops the pull before any Drive call", async () => {
        mockSelectResults.push([connection({ status: "revoked", lastRefreshError: "gone" })]);

        const outcome = await pullDriveLink(link());

        expect(outcome).toMatchObject({ kind: "auth_revoked", detail: "gone" });
        expect(mockToken).not.toHaveBeenCalled();
    });
});

describe("linkability helpers", () => {
    it("accepts docx and pdf in any of the three identity forms", () => {
        expect(isDriveLinkableDocument("docx", null, "Contract")).toBe(true);
        expect(isDriveLinkableDocument(null, "application/pdf", "Contract")).toBe(true);
        expect(isDriveLinkableDocument(null, null, "contract.PDF")).toBe(true);
        expect(isDriveLinkableDocument("xlsx", null, "sheet.xlsx")).toBe(false);
        expect(isDriveLinkableDocument(null, "text/plain", "notes.txt")).toBe(false);
    });

    it("resolves the canonical MIME the versions route will lock against", () => {
        expect(resolveCanonicalMime("pdf", null, "x")).toBe("application/pdf");
        expect(resolveCanonicalMime("docx", null, "x")).toContain("wordprocessingml");
    });

    it("names the Drive copy with the right extension exactly once", () => {
        expect(linkedFilename("Contract", "application/pdf")).toBe("Contract.pdf");
        expect(linkedFilename("contract.pdf", "application/pdf")).toBe("contract.pdf");
    });
});
