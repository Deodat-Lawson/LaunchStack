import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/documents/[id]/retry/route";
import { retrySourceProcessing } from "@launchstack/orchestration";
import { db } from "~/server/db";
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

jest.mock("~/server/services/folder-access", () => ({
    DOCUMENT_EDIT_DENIED: "You can view this file but not change it.",
}));

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

// The transaction itself is covered against Postgres in
// packages/orchestration/__tests__/source-lifecycle.integration.test.ts.
jest.mock("@launchstack/orchestration", () => ({
    retrySourceProcessing: jest.fn(),
}));

jest.mock("~/server/db", () => ({
    db: { select: jest.fn() },
}));

jest.mock("@launchstack/store/schema", () => ({
    document: { id: "document.id", category: "document.category" },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
}));

const workspaceContext = makeWorkspaceContext({
    authUserId: "user-1",
    companyId: BigInt(10),
    role: "member",
});

const mockSelect = db.select as jest.Mock;
const mockRetry = retrySourceProcessing as jest.Mock;

function documentInScope(rows: unknown[] = [{ id: 55, category: "books" }]) {
    const where = jest.fn().mockResolvedValue(rows);
    mockSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where }) });
    return where;
}

function signedIn(context = workspaceContext) {
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: context });
}

function retry(id = "55", headers: Record<string, string> = {}) {
    return POST(
        new Request(`https://app.example/api/documents/${id}/retry`, { method: "POST", headers }),
        { params: Promise.resolve({ id }) }
    );
}

describe("POST /api/documents/[id]/retry", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        signedIn();
        documentInScope();
        mockRetry.mockResolvedValue({
            status: "retrying",
            jobId: "job-1",
            stage: "evidence.version.extracted",
            retryCount: 1,
        });
    });

    it("re-runs the stage that gave up and says which", async () => {
        const response = await retry();

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
            status: "retrying",
            stage: "evidence.version.extracted",
            jobId: "job-1",
            retryCount: 1,
        });
        expect(mockRetry).toHaveBeenCalledWith({
            companyId: BigInt(10),
            documentId: 55,
            userId: "user-1",
        });
    });

    it("refuses someone without documents.upload before reading anything", async () => {
        signedIn(makeWorkspaceContext({ role: "viewer", companyId: BigInt(10) }));

        const response = await retry();

        expect(response.status).toBe(403);
        expect(mockSelect).not.toHaveBeenCalled();
        expect(mockRetry).not.toHaveBeenCalled();
    });

    it("reads a document outside the caller's scope as missing", async () => {
        const where = documentInScope([]);

        const response = await retry();

        expect(response.status).toBe(404);
        expect(where).toHaveBeenCalledWith(
            expect.objectContaining({
                op: "and",
                conditions: expect.arrayContaining([{ op: "scoped", companyId: BigInt(10) }]),
            })
        );
        expect(mockRetry).not.toHaveBeenCalled();
    });

    it("refuses someone who can view the file but not edit it", async () => {
        (canEditDocument as jest.Mock).mockResolvedValueOnce(false);

        const response = await retry();

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "You can view this file but not change it.",
        });
        expect(canEditDocument).toHaveBeenCalledWith(workspaceContext, {
            id: 55,
            category: "books",
        });
        expect(mockRetry).not.toHaveBeenCalled();
    });

    it("rejects an id that is not a positive integer", async () => {
        for (const id of ["abc", "0", "-4", "1.5"]) {
            const response = await retry(id);
            expect(response.status).toBe(400);
        }
        expect(mockRetry).not.toHaveBeenCalled();
    });

    it.each([
        ["not_failed", { status: "not_failed", jobStatus: "completed" }],
        ["already_running", { status: "already_running" }],
        ["no_job", { status: "no_job" }],
    ])("answers 409 when there is nothing to retry (%s)", async (status, result) => {
        mockRetry.mockResolvedValueOnce(result);

        const response = await retry();

        expect(response.status).toBe(409);
        const body = (await response.json()) as { status: string; error: string };
        expect(body.status).toBe(status);
        expect(body.error).toEqual(expect.any(String));
    });

    it("answers 404 when the document vanished between the check and the retry", async () => {
        mockRetry.mockResolvedValueOnce({ status: "not_found" });

        const response = await retry();

        expect(response.status).toBe(404);
    });

    it("answers 500 without leaking the error when the retry throws", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockRetry.mockRejectedValueOnce(new Error("deadlock detected on pdr_ai_v2_document"));

        const response = await retry();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: "Could not retry processing" });
        spy.mockRestore();
    });
});

describe("POST /api/documents/[id]/retry in the reader's language", () => {
    const chinese = { cookie: "ls-locale=zh-CN.1" };

    beforeEach(() => {
        jest.clearAllMocks();
        signedIn();
        documentInScope();
    });

    it("refuses a view-only file in Chinese", async () => {
        (canEditDocument as jest.Mock).mockResolvedValueOnce(false);

        const response = await retry("55", chinese);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "你可以查看此文件，但不能修改它。",
        });
    });

    it("says why there is nothing to retry in Chinese, keeping the status code", async () => {
        mockRetry.mockResolvedValueOnce({ status: "already_running" });

        const response = await retry("55", chinese);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "此来源正在处理中。",
            status: "already_running",
        });
    });

    it("keeps the English for a reader with no language chosen", async () => {
        mockRetry.mockResolvedValueOnce({ status: "already_running" });

        const response = await retry();

        await expect(response.json()).resolves.toEqual({
            error: "This source is already being processed.",
            status: "already_running",
        });
    });

    it("words a bad id in Chinese", async () => {
        const response = await retry("abc", chinese);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "文档 ID 无效" });
    });
});
