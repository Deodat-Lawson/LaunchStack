/** @jest-environment node */

const mockPermission = jest.fn();
const mockCanEdit = jest.fn();
const mockPlanVersionDeletion = jest.fn();
const mockRowDelete = jest.fn();
const mockLock = jest.fn();
const mockTransaction = jest.fn();
const mockDeleteTable = jest.fn();
const mockSelectQueue: unknown[][] = [];

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: () => mockPermission(),
}));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => ({}) }));
jest.mock("~/server/workspace/item-access", () => ({
    canEditDocument: (...args: unknown[]) => mockCanEdit(...args),
}));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("~/server/storage/deletion/plan", () => ({
    planVersionDeletion: (...args: unknown[]) => mockPlanVersionDeletion(...args),
}));
function mockSelectBuilder() {
    const builder: Record<string, unknown> = {
        from: () => builder,
        where: () => builder,
        then: (resolve: (rows: unknown[]) => unknown) => resolve(mockSelectQueue.shift() ?? []),
        for: (mode: string) => {
            mockLock(mode);
            return Promise.resolve(mockSelectQueue.shift() ?? []);
        },
    };
    return builder;
}
const mockTx = {
    select: mockSelectBuilder,
    delete: (table: unknown) => {
        mockDeleteTable(table);
        return { where: mockRowDelete };
    },
};
jest.mock("~/server/db", () => ({
    db: {
        select: mockSelectBuilder,
        transaction: (callback: (tx: typeof mockTx) => unknown) => mockTransaction(callback),
    },
}));

import { DELETE } from "~/app/api/documents/[id]/versions/[versionId]/route";
import { documentVersions, ocrJobs } from "@launchstack/store/schema";

function call() {
    return DELETE(new Request("http://app.test/api/documents/7/versions/9"), {
        params: Promise.resolve({ id: "7", versionId: "9" }),
    });
}
function seed(url = "/api/files/42", currentVersionId = 10, versions = [{ id: 9 }, { id: 10 }]) {
    mockSelectQueue.push(
        [{ id: 7, category: "document", currentVersionId }],
        [{ id: 7, category: "document", currentVersionId }],
        [{ id: 9, versionNumber: 1, url }],
        versions
    );
}
beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockPermission.mockResolvedValue({
        success: true,
        data: { companyId: BigInt(1), authUserId: "user1", documentScope: async () => ({}) },
    });
    mockCanEdit.mockResolvedValue(true);
    mockPlanVersionDeletion.mockResolvedValue(5);
    mockRowDelete.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(callback => callback(mockTx));
});

it.each(["/api/files/42", "https://foreign.example/file.pdf", "https://app1.ufs.sh/f/key"])(
    "synchronously removes the version while planning deferred cleanup of %s",
    async url => {
        seed(url);
        const response = await call();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
            expect.objectContaining({
                success: true,
                documentId: 7,
                versionId: 9,
                versionNumber: 1,
            })
        );
        expect(mockPlanVersionDeletion).toHaveBeenCalledWith(mockTx, {
            documentId: 7,
            versionId: 9,
            requestedBy: "user1",
            reason: "version_delete",
            traceId: expect.any(String),
        });
        expect(mockLock.mock.calls).toEqual([["update"], ["update"], ["update"]]);
        expect(mockRowDelete).toHaveBeenCalledTimes(2);
        expect(mockDeleteTable.mock.calls).toEqual([[ocrJobs], [documentVersions]]);
        expect(mockPlanVersionDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            mockRowDelete.mock.invocationCallOrder[0]!
        );
    }
);

it("does not remove relational rows if planning fails", async () => {
    seed();
    mockPlanVersionDeletion.mockRejectedValueOnce(new Error("outbox unavailable"));
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        expect((await call()).status).toBe(500);
        expect(mockRowDelete).not.toHaveBeenCalled();
    } finally {
        quiet.mockRestore();
    }
});
it.each([
    { current: 9, versions: [{ id: 9 }, { id: 10 }], description: "current version" },
    { current: 10, versions: [{ id: 9 }], description: "only version" },
])("keeps the 409 guard for the $description", async ({ current, versions }) => {
    seed(undefined, current, versions);
    expect((await call()).status).toBe(409);
    expect(mockPlanVersionDeletion).not.toHaveBeenCalled();
    expect(mockRowDelete).not.toHaveBeenCalled();
});
it("keeps edit permission checks before opening the deletion transaction", async () => {
    seed();
    mockCanEdit.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockPlanVersionDeletion).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
});
it("does not plan a version from another document", async () => {
    mockSelectQueue.push(
        [{ id: 7, category: "document", currentVersionId: 10 }],
        [{ id: 7, category: "document", currentVersionId: 10 }],
        []
    );
    expect((await call()).status).toBe(404);
    expect(mockPlanVersionDeletion).not.toHaveBeenCalled();
});
it("rechecks the current-version guard against the locked document", async () => {
    seed();
    mockSelectQueue[1] = [{ id: 7, category: "document", currentVersionId: 9 }];
    expect((await call()).status).toBe(409);
    expect(mockPlanVersionDeletion).not.toHaveBeenCalled();
    expect(mockRowDelete).not.toHaveBeenCalled();
});
