/** @jest-environment node */

const mockPermission = jest.fn();
const mockCanEdit = jest.fn();
const mockDriveLink = jest.fn();
const mockPlanObjectDeletion = jest.fn();
const mockUpdate = jest.fn();
const mockSet = jest.fn();
const mockTransaction = jest.fn();
const mockLock = jest.fn();
const mockSelectQueue: unknown[][] = [];

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: () => mockPermission(),
}));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => ({}) }));
jest.mock("~/server/workspace/item-access", () => ({
    canEditDocument: (...args: unknown[]) => mockCanEdit(...args),
}));
jest.mock("~/server/services/google-drive/links", () => ({
    getActiveDriveLink: (...args: unknown[]) => mockDriveLink(...args),
}));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("~/server/storage/deletion/plan", () => ({
    planObjectDeletion: (...args: unknown[]) => mockPlanObjectDeletion(...args),
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
    update: () => ({
        set: (values: unknown) => {
            mockSet(values);
            return { where: mockUpdate };
        },
    }),
};
jest.mock("~/server/db", () => ({
    db: {
        select: mockSelectBuilder,
        transaction: (callback: (tx: typeof mockTx) => unknown) => mockTransaction(callback),
    },
}));

import { POST } from "~/app/api/documents/[id]/versions/[versionId]/revert/route";

function call() {
    return POST(new Request("http://app.test/api/documents/7/versions/9/revert"), {
        params: Promise.resolve({ id: "7", versionId: "9" }),
    });
}
function seed(currentUrl = "/api/files/42", targetUrl = "/api/files/43", currentVersionId = 10) {
    const doc = { id: 7, companyId: 1n, category: "Docs", currentVersionId, url: currentUrl };
    mockSelectQueue.push(
        [doc],
        [doc],
        [{ id: 9, versionNumber: 1, url: targetUrl, mimeType: "application/pdf" }]
    );
}
beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockPermission.mockResolvedValue({
        success: true,
        data: { companyId: 1n, authUserId: "user1", documentScope: async () => ({}) },
    });
    mockCanEdit.mockResolvedValue(true);
    mockDriveLink.mockResolvedValue(null);
    mockPlanObjectDeletion.mockResolvedValue(5);
    mockUpdate.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(callback => callback(mockTx));
});

it("plans the displaced URL before updating the current pointer in the same transaction", async () => {
    seed();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
        success: true,
        documentId: 7,
        versionId: 9,
        versionNumber: 1,
        alreadyCurrent: false,
    });
    expect(mockPlanObjectDeletion).toHaveBeenCalledWith(mockTx, {
        companyId: 1n,
        urls: ["/api/files/42"],
        requestedBy: "user1",
        reason: "version_revert",
        traceId: expect.any(String),
    });
    expect(mockSet).toHaveBeenCalledWith({
        currentVersionId: 9n,
        url: "/api/files/43",
        mimeType: "application/pdf",
    });
    expect(mockPlanObjectDeletion.mock.invocationCallOrder[0]).toBeLessThan(
        mockUpdate.mock.invocationCallOrder[0]!
    );
    expect(mockLock.mock.calls).toEqual([["update"], ["update"]]);
});
it("does not plan unchanged bytes while switching versions", async () => {
    seed("/api/files/42", "/api/files/42");
    expect((await call()).status).toBe(200);
    expect(mockPlanObjectDeletion).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it("rechecks the already-current no-op under the document lock", async () => {
    seed();
    mockSelectQueue[1] = [{ id: 7, companyId: 1n, currentVersionId: 9, url: "/api/files/43" }];
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyCurrent: true });
    expect(mockPlanObjectDeletion).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
});
it("does not overwrite the URL if durable planning fails", async () => {
    seed();
    mockPlanObjectDeletion.mockRejectedValueOnce(new Error("outbox unavailable"));
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        expect((await call()).status).toBe(500);
        expect(mockUpdate).not.toHaveBeenCalled();
    } finally {
        quiet.mockRestore();
    }
});
it("resolves item permissions before opening the transaction", async () => {
    seed();
    mockCanEdit.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
});
it("preserves the linked Drive guard before opening the transaction", async () => {
    seed();
    mockDriveLink.mockResolvedValue({ driveWebViewLink: "https://drive.google.com/file/7" });
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "linked_to_google_drive" });
    expect(mockTransaction).not.toHaveBeenCalled();
});
it("rejects a version from another document without planning or updating", async () => {
    seed();
    mockSelectQueue[2] = [];
    expect((await call()).status).toBe(404);
    expect(mockPlanObjectDeletion).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
});
