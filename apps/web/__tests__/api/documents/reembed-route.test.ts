import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/documents/[id]/reembed/route";
import {
    findReembedTarget,
    loadReembedDocument,
    reembedDocument,
    type ReembedTarget,
} from "~/server/services/reembed-source";
import { canEditDocument } from "~/server/workspace/item-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

// ADR-014's level rules are tested in item-access.test; here only the
// route's use of the answer is.
jest.mock("~/server/workspace/item-access", () => ({
    canEditDocument: jest.fn().mockResolvedValue(true),
}));

jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint) => ({ op: "scoped", companyId }),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { strict: {} },
}));

// The version it makes is covered against Postgres in
// reembed-source.integration.test.ts.
jest.mock("~/server/services/reembed-source", () => ({
    loadReembedDocument: jest.fn(),
    findReembedTarget: jest.fn(),
    reembedDocument: jest.fn(),
}));

const workspaceContext = makeWorkspaceContext({
    authUserId: "user-1",
    companyId: BigInt(10),
    role: "member",
});

const mockLoad = loadReembedDocument as jest.Mock;
const mockTarget = findReembedTarget as jest.Mock;
const mockReembed = reembedDocument as jest.Mock;
const mockCanEdit = canEditDocument as jest.Mock;

function row(overrides: Partial<ReembedTarget> = {}): ReembedTarget {
    return {
        id: 55,
        companyId: BigInt(10),
        title: "Handbook.pdf",
        category: "books",
        url: "/api/files/9",
        mimeType: "application/pdf",
        fileType: "application/pdf",
        ocrEnabled: true,
        ocrJobId: "job-1",
        creationKey: null,
        currentVersionId: BigInt(3),
        ...overrides,
    };
}

function signedIn(context = workspaceContext) {
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: context });
}

function reembed(id = "55", headers: Record<string, string> = {}) {
    return POST(
        new Request(`https://app.example/api/documents/${id}/reembed`, {
            method: "POST",
            headers,
        }),
        { params: Promise.resolve({ id }) }
    );
}

describe("POST /api/documents/[id]/reembed", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        signedIn();
        const doc = row();
        mockLoad.mockResolvedValue(doc);
        mockTarget.mockImplementation((d: ReembedTarget) => Promise.resolve(d));
        mockReembed.mockResolvedValue({
            status: "reembedding",
            documentId: 55,
            versionId: 41,
            versionNumber: 4,
            jobId: "job-2",
        });
    });

    it("starts a new version of the same file and says which", async () => {
        const response = await reembed();

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
            status: "reembedding",
            documentId: 55,
            versionId: 41,
            versionNumber: 4,
            jobId: "job-2",
        });
        expect(mockLoad).toHaveBeenCalledWith(55, { op: "scoped", companyId: BigInt(10) });
        expect(mockReembed).toHaveBeenCalledWith({ target: row(), userId: "user-1" });
    });

    it("refuses someone without documents.upload before reading anything", async () => {
        signedIn(makeWorkspaceContext({ role: "viewer", companyId: BigInt(10) }));

        const response = await reembed();

        expect(response.status).toBe(403);
        expect(mockLoad).not.toHaveBeenCalled();
        expect(mockReembed).not.toHaveBeenCalled();
    });

    it("reads a document outside the caller's scope as missing", async () => {
        mockLoad.mockResolvedValueOnce(null);

        const response = await reembed();

        expect(response.status).toBe(404);
        expect(mockReembed).not.toHaveBeenCalled();
    });

    it("refuses someone who can view the file but not edit it", async () => {
        mockCanEdit.mockResolvedValueOnce(false);

        const response = await reembed();

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "You can view this file but not change it.",
        });
        expect(mockCanEdit).toHaveBeenCalledWith(workspaceContext, { id: 55, category: "books" });
        expect(mockReembed).not.toHaveBeenCalled();
    });

    it("re-embeds a recording's transcript, checking edit access to that too", async () => {
        const recording = row({ id: 70, ocrEnabled: false, mimeType: "audio/mpeg" });
        const transcript = row({ id: 71, title: "Call (Transcription)", category: "calls" });
        mockLoad.mockResolvedValueOnce(recording);
        mockTarget.mockResolvedValueOnce(transcript);

        const response = await reembed("70");

        expect(response.status).toBe(202);
        expect(mockCanEdit).toHaveBeenNthCalledWith(2, workspaceContext, {
            id: 71,
            category: "calls",
        });
        expect(mockReembed).toHaveBeenCalledWith({ target: transcript, userId: "user-1" });
    });

    it("refuses when the caller can edit the recording but not its transcript", async () => {
        mockLoad.mockResolvedValueOnce(row({ id: 70, ocrEnabled: false }));
        mockTarget.mockResolvedValueOnce(row({ id: 71, category: "private" }));
        mockCanEdit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const response = await reembed("70");

        expect(response.status).toBe(403);
        expect(mockReembed).not.toHaveBeenCalled();
    });

    it("answers 409 for a recording with no transcript to read", async () => {
        mockTarget.mockResolvedValueOnce(null);

        const response = await reembed();

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "This source has no stored file to read again.",
            status: "no_file",
        });
    });

    it("rejects an id that is not a positive integer", async () => {
        for (const id of ["abc", "0", "-4", "1.5"]) {
            const response = await reembed(id);
            expect(response.status).toBe(400);
        }
        expect(mockReembed).not.toHaveBeenCalled();
    });

    it.each([
        ["already_running", "This source is already being processed."],
        ["no_file", "This source has no stored file to read again."],
        ["archive", "An archive is split into the files inside it. Re-embed those files instead."],
    ])("answers 409 when nothing was started (%s)", async (status, error) => {
        mockReembed.mockResolvedValueOnce({ status });

        const response = await reembed();

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error, status });
    });

    it("answers 500 without leaking the error when re-embedding throws", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockReembed.mockRejectedValueOnce(new Error("deadlock detected on pdr_ai_v2_document"));

        const response = await reembed();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: "Could not re-embed this source",
        });
        spy.mockRestore();
    });

    it("says why nothing was started in Chinese, keeping the status code", async () => {
        mockReembed.mockResolvedValueOnce({ status: "already_running" });

        const response = await reembed("55", { cookie: "ls-locale=zh-CN.1" });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "此来源正在处理中。",
            status: "already_running",
        });
    });
});
