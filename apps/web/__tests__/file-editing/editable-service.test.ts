/**
 * The editor's load and save (server/services/file-editing/editable).
 *
 * The invariants worth pinning: a stale save is refused before anything is
 * written; a stored file's save is a new version credited to the editor; a
 * Drive-linked file is read from Drive and saved *to* Drive (HTML into a
 * native Doc, Word bytes into a linked .docx), then pulled back as the
 * editor's version.
 */
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn(), fetchFile: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentVersionLifecycle: jest.fn(),
}));
jest.mock("~/server/services/google-drive/config", () => ({
    isDriveLinkingEnabled: jest.fn(() => true),
}));
jest.mock("~/server/services/google-drive/connections", () => {
    class GoogleNotConnectedError extends Error {}
    return { GoogleNotConnectedError, getAccessTokenForConnection: jest.fn() };
});
jest.mock("~/server/services/google-drive/sync", () => ({
    pullDriveLink: jest.fn(),
    toProcessingUrl: (url: string) => `https://app.test${url}`,
}));
jest.mock("~/server/services/google-drive/links", () => ({
    ...jest.requireActual("~/server/services/google-drive/links"),
    getActiveDriveLink: jest.fn(),
    getDriveLinkForDocument: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    getFileMetadata: jest.fn(),
    exportFileContent: jest.fn(),
    downloadFileContent: jest.fn(),
    updateFileMedia: jest.fn(),
}));

const mockSelectResults: unknown[][] = [];
const mockUpdates: Array<Record<string, unknown>> = [];
function mockChain(): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy(
        {},
        {
            get(_t, prop) {
                if (prop === "then") {
                    const result = mockSelectResults.shift() ?? [];
                    return (resolve: (v: unknown) => void) => resolve(result);
                }
                return () => proxy;
            },
        }
    );
    return proxy;
}
jest.mock("~/server/db", () => ({
    db: {
        select: () => mockChain(),
        update: () => ({
            set: (values: Record<string, unknown>) => {
                mockUpdates.push(values);
                return { where: jest.fn().mockResolvedValue(undefined) };
            },
        }),
    },
}));

import {
    DOCX_MIME,
    GOOGLE_DOC_MIME,
    GoogleAuthError,
    downloadFileContent,
    exportFileContent,
    getFileMetadata,
    updateFileMedia,
} from "@launchstack/google-drive";

import { fetchFile, uploadFile } from "~/lib/storage";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { getAccessTokenForConnection } from "~/server/services/google-drive/connections";
import { getActiveDriveLink, getDriveLinkForDocument } from "~/server/services/google-drive/links";
import { pullDriveLink } from "~/server/services/google-drive/sync";
import { htmlToDocx } from "~/server/services/file-editing/convert";
import {
    FileEditError,
    loadEditable,
    saveEditable,
    type EditableDocument,
} from "~/server/services/file-editing/editable";

const mockFetchFile = fetchFile as jest.Mock;
const mockUpload = uploadFile as jest.Mock;
const mockLifecycle = createDocumentVersionLifecycle as jest.Mock;
const mockActiveLink = getActiveDriveLink as jest.Mock;
const mockLinkFor = getDriveLinkForDocument as jest.Mock;
const mockToken = getAccessTokenForConnection as jest.Mock;
const mockMeta = getFileMetadata as jest.Mock;
const mockExport = exportFileContent as jest.Mock;
const mockDownload = downloadFileContent as jest.Mock;
const mockUpdateMedia = updateFileMedia as jest.Mock;
const mockPull = pullDriveLink as jest.Mock;

function doc(overrides: Partial<EditableDocument> = {}): EditableDocument {
    return {
        id: 5,
        companyId: BigInt(9),
        title: "Plan",
        category: "Strategy",
        url: "/api/files/41",
        mimeType: "text/markdown",
        fileType: "text/markdown",
        currentVersionId: BigInt(70),
        ocrMetadata: null,
        ...overrides,
    };
}

function stored(body: string | Buffer, status = 200) {
    mockFetchFile.mockResolvedValue(
        new Response(typeof body === "string" ? body : new Uint8Array(body), { status })
    );
}

const LINK = {
    id: 3,
    documentId: BigInt(5),
    connectionId: BigInt(2),
    driveFileId: "file-1",
    driveWebViewLink: "https://docs.google.com/document/d/file-1/edit",
    status: "linked",
    lastSyncedRevisionId: "v12",
};
const CONNECTION = { id: 2, status: "active", providerAccountEmail: "team@example.com" };
const WORD = { mimeType: DOCX_MIME, fileType: DOCX_MIME, title: "Contract" };

function linked(meta: Record<string, unknown>) {
    mockActiveLink.mockResolvedValue(LINK);
    mockSelectResults.push([CONNECTION]);
    mockToken.mockResolvedValue("access");
    mockMeta.mockResolvedValue({ id: "file-1", trashed: false, ...meta });
}

const SAVE = { userId: "auth-7", requestUrl: "https://app.test/api/documents/5/editable" };

beforeEach(() => {
    jest.clearAllMocks();
    mockSelectResults.length = 0;
    mockUpdates.length = 0;
    mockActiveLink.mockResolvedValue(null);
    mockUpload.mockResolvedValue({ url: "/api/files/88", provider: "database" });
    mockLifecycle.mockResolvedValue({ versionId: 71, version: { versionNumber: 2 } });
});

describe("loadEditable — stored files", () => {
    it("opens Markdown as editor HTML against the current version", async () => {
        stored("# Plan\n\n- one\n- two\n");
        const payload = await loadEditable(doc());
        expect(payload).toMatchObject({
            documentId: 5,
            kind: "markdown",
            mode: "rich",
            text: "",
            base: "v:70",
            drive: null,
            noticeKey: null,
        });
        expect(payload.html).toContain("<h1>Plan</h1>");
        expect(payload.html).toMatch(/<li>one<\/li>/);
    });

    it("opens plain text as text", async () => {
        stored("﻿line one\nline two");
        const payload = await loadEditable(
            doc({ mimeType: "text/plain", fileType: "text/plain", title: "a.txt" })
        );
        expect(payload).toMatchObject({
            kind: "text",
            mode: "plain",
            html: "",
            text: "line one\nline two",
        });
    });

    it("opens Word with the notice about what a save keeps", async () => {
        stored(await htmlToDocx("<h1>Terms</h1><p><strong>Bold</strong></p>", "Contract"));
        const payload = await loadEditable(doc(WORD));
        expect(payload).toMatchObject({ kind: "docx", mode: "rich", noticeKey: "docxNotice" });
        expect(payload.html).toContain("<h1>Terms</h1>");
        expect(payload.html).toContain("<strong>Bold</strong>");
    });

    it("refuses a kind it cannot edit", async () => {
        await expect(
            loadEditable(
                doc({ mimeType: "application/pdf", fileType: "application/pdf", title: "a.pdf" })
            )
        ).rejects.toMatchObject({ status: 415, code: "not_editable" });
        expect(mockFetchFile).not.toHaveBeenCalled();
    });

    it("says so when storage cannot be read", async () => {
        stored("nope", 503);
        await expect(loadEditable(doc())).rejects.toMatchObject({
            status: 502,
            code: "read_failed",
            values: { status: "503" },
        });
    });
});

describe("saveEditable — stored files", () => {
    it("refuses a save over a version it did not open, writing nothing", async () => {
        const err = await saveEditable({
            ...SAVE,
            doc: doc(),
            base: "v:69",
            html: "<p>x</p>",
        }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(FileEditError);
        expect(err).toMatchObject({ status: 409, code: "changed_since_opened" });
        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockLifecycle).not.toHaveBeenCalled();
    });

    it("writes Markdown as a new version credited to the editor", async () => {
        const result = await saveEditable({
            ...SAVE,
            doc: doc(),
            base: "v:70",
            html: "<h1>Plan</h1><ul><li><p>one</p></li></ul>",
        });
        expect(result).toEqual({ versionId: 71, versionNumber: 2, base: "v:71" });

        const upload = mockUpload.mock.calls[0]![0] as {
            data: Buffer;
            contentType: string;
            filename: string;
        };
        expect(upload.contentType).toBe("text/markdown");
        expect(upload.filename).toBe("Plan.md");
        expect(upload.data.toString("utf8")).toBe("# Plan\n\n- one\n");

        expect(mockLifecycle).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: 5,
                userId: "auth-7",
                url: "/api/files/88",
                processingUrl: "https://app.test/api/files/88",
                mimeType: "text/markdown",
                changelog: "Edited in LaunchStack",
                creationKey: expect.stringMatching(/^edit:5:v:70:[0-9a-f]{64}$/),
            })
        );
    });

    it("writes plain text as given", async () => {
        await saveEditable({
            ...SAVE,
            doc: doc({ mimeType: "text/plain", fileType: "text/plain", title: "notes.txt" }),
            base: "v:70",
            text: "hello\nworld",
        });
        const upload = mockUpload.mock.calls[0]![0] as { data: Buffer; filename: string };
        expect(upload.data.toString("utf8")).toBe("hello\nworld");
        expect(upload.filename).toBe("notes.txt");
    });

    it("refuses HTML for a plain-text file", async () => {
        await expect(
            saveEditable({
                ...SAVE,
                doc: doc({ mimeType: "text/plain", fileType: "text/plain" }),
                base: "v:70",
                html: "<p>x</p>",
            })
        ).rejects.toMatchObject({ status: 400, code: "invalid" });
    });

    it("writes Word as a .docx with the document's own type", async () => {
        await saveEditable({ ...SAVE, doc: doc(WORD), base: "v:70", html: "<h1>Terms</h1>" });
        const upload = mockUpload.mock.calls[0]![0] as {
            data: Buffer;
            contentType: string;
            filename: string;
        };
        expect(upload.contentType).toBe(DOCX_MIME);
        expect(upload.filename).toBe("Contract.docx");
        expect(upload.data.subarray(0, 2).toString()).toBe("PK");
    });
});

describe("Drive-linked files", () => {
    it("open fresh from Drive: a native Doc is exported as Word for the editor", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "12" });
        mockExport.mockResolvedValue(await htmlToDocx("<h1>From Docs</h1>", "Contract"));

        const payload = await loadEditable(doc(WORD));

        expect(mockExport).toHaveBeenCalledWith({
            accessToken: "access",
            fileId: "file-1",
            mimeType: DOCX_MIME,
        });
        expect(mockFetchFile).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            kind: "docx",
            base: "drive:v12",
            drive: { url: LINK.driveWebViewLink, native: true },
            noticeKey: "driveNotice",
        });
        expect(payload.html).toContain("<h1>From Docs</h1>");
    });

    it("open a linked .docx by its head revision", async () => {
        linked({ mimeType: DOCX_MIME, headRevisionId: "rev-9" });
        mockDownload.mockResolvedValue(await htmlToDocx("<p>Office</p>", "Contract"));
        const payload = await loadEditable(doc(WORD));
        expect(payload.base).toBe("drive:rev-9");
        expect(payload.drive).toEqual({ url: LINK.driveWebViewLink, native: false });
    });

    it("fall back to the stored copy when the Drive file was trashed, orphaning the link", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "12", trashed: true });
        stored(await htmlToDocx("<p>Stored</p>", "Contract"));
        const payload = await loadEditable(doc(WORD));
        expect(mockUpdates[0]).toMatchObject({ status: "orphaned" });
        expect(payload.base).toBe("v:70");
        expect(payload.drive).toBeNull();
        expect(payload.html).toContain("Stored");
    });

    it("say the Google connection is gone when it was revoked", async () => {
        mockActiveLink.mockResolvedValue(LINK);
        mockSelectResults.push([{ ...CONNECTION, status: "revoked" }]);
        await expect(loadEditable(doc(WORD))).rejects.toMatchObject({
            status: 409,
            code: "google_not_connected",
        });
    });

    it("say the Google connection is gone when Google refuses the grant", async () => {
        mockActiveLink.mockResolvedValue(LINK);
        mockSelectResults.push([CONNECTION]);
        mockToken.mockRejectedValue(new GoogleAuthError(400, "invalid_grant", true));
        await expect(loadEditable(doc(WORD))).rejects.toMatchObject({
            code: "google_not_connected",
        });
    });

    it("refuse a save when the Doc changed in Google since it was opened, writing nothing", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "14" });
        await expect(
            saveEditable({ ...SAVE, doc: doc(WORD), base: "drive:v12", html: "<p>mine</p>" })
        ).rejects.toMatchObject({
            status: 409,
            code: "changed_since_opened",
            key: "changedInGoogleDocs",
        });
        expect(mockUpdateMedia).not.toHaveBeenCalled();
        expect(mockPull).not.toHaveBeenCalled();
    });

    it("save a native Doc as HTML Drive converts, then pull it back as the editor's version", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "12" });
        mockUpdateMedia.mockResolvedValue({ id: "file-1", version: "13" });
        mockPull.mockResolvedValue({
            kind: "synced",
            versionId: 80,
            versionNumber: 4,
            fidelityWarning: false,
        });
        mockLinkFor.mockResolvedValue({ ...LINK, lastSyncedRevisionId: "v13" });

        const result = await saveEditable({
            ...SAVE,
            doc: doc(WORD),
            base: "drive:v12",
            html: `<h1>New</h1><p onclick="x()">body<script>bad()</script></p>`,
        });

        const push = mockUpdateMedia.mock.calls[0]![0] as {
            mimeType: string;
            data: Buffer;
            fileId: string;
        };
        expect(push.fileId).toBe("file-1");
        expect(push.mimeType).toBe("text/html");
        const html = push.data.toString("utf8");
        expect(html).toMatch(
            /^<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contract<\/title>/
        );
        expect(html).toContain("<h1>New</h1><p>body</p>");
        expect(html).not.toMatch(/onclick|script/);

        expect(mockPull).toHaveBeenCalledWith(LINK, {
            force: true,
            requestUrl: SAVE.requestUrl,
            actor: "auth-7",
            changelog: "Edited in LaunchStack",
        });
        expect(result).toEqual({ versionId: 80, versionNumber: 4, base: "drive:v13" });
        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockLifecycle).not.toHaveBeenCalled();
    });

    it("save a linked .docx as Word bytes", async () => {
        linked({ mimeType: DOCX_MIME, headRevisionId: "rev-9" });
        mockUpdateMedia.mockResolvedValue({ id: "file-1", headRevisionId: "rev-10" });
        mockPull.mockResolvedValue({
            kind: "synced",
            versionId: 81,
            versionNumber: 5,
            fidelityWarning: false,
        });
        mockLinkFor.mockResolvedValue({ ...LINK, lastSyncedRevisionId: "rev-10" });

        const result = await saveEditable({
            ...SAVE,
            doc: doc(WORD),
            base: "drive:rev-9",
            html: "<p>w</p>",
        });

        const push = mockUpdateMedia.mock.calls[0]![0] as { mimeType: string; data: Buffer };
        expect(push.mimeType).toBe(DOCX_MIME);
        expect(push.data.subarray(0, 2).toString()).toBe("PK");
        expect(result.base).toBe("drive:rev-10");
    });

    it("report a pending sync when the push landed but the pull did not", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "12" });
        mockUpdateMedia.mockResolvedValue({ id: "file-1", version: "13" });
        mockPull.mockResolvedValue({ kind: "error", detail: "boom", retryable: true });
        mockLinkFor.mockResolvedValue({ ...LINK, lastSyncedRevisionId: "v12" });
        mockSelectResults.push([{ id: 70, versionNumber: 3 }]);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await saveEditable({
            ...SAVE,
            doc: doc(WORD),
            base: "drive:v12",
            html: "<p>x</p>",
        });
        expect(result).toEqual({
            versionId: 70,
            versionNumber: 3,
            base: "drive:v12",
            syncPending: true,
        });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("refuse a save opened as a stored file after the document was linked", async () => {
        linked({ mimeType: GOOGLE_DOC_MIME, version: "12" });
        await expect(
            saveEditable({ ...SAVE, doc: doc(WORD), base: "v:70", html: "<p>x</p>" })
        ).rejects.toMatchObject({ status: 409, code: "changed_since_opened" });
        expect(mockUpdateMedia).not.toHaveBeenCalled();
    });

    it("refuse a linked PDF", async () => {
        mockActiveLink.mockResolvedValue(LINK);
        await expect(
            loadEditable(
                doc({ mimeType: "application/pdf", fileType: "application/pdf", title: "a.pdf" })
            )
        ).rejects.toMatchObject({ status: 415, code: "not_editable" });
    });
});
