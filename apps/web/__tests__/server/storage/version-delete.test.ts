/** @jest-environment node */

const mockPermission = jest.fn();
const mockDeleteStoredObjects = jest.fn();
const mockRowDelete = jest.fn();
const mockSelectQueue: unknown[][] = [];
const mockServer: Record<string, string | undefined> = {};

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServer };
    },
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: () => mockPermission(),
}));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => ({}) }));
jest.mock("~/server/workspace/item-access", () => ({ canEditDocument: async () => true }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("~/server/storage/delete-objects", () => ({
    deleteStoredObjects: (refs: unknown) => mockDeleteStoredObjects(refs),
}));
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({ from: () => ({ where: async () => mockSelectQueue.shift() ?? [] }) }),
        delete: () => ({ where: mockRowDelete }),
    },
}));

import { DELETE } from "~/app/api/documents/[id]/versions/[versionId]/route";

function call(url = "/api/files/42") {
    mockSelectQueue.push(
        [{ id: 7, category: "document", currentVersionId: 10 }],
        [{ id: 9, versionNumber: 1, url }],
        [{ id: 9 }, { id: 10 }]
    );
    return DELETE(new Request("http://app.test/api/documents/7/versions/9"), {
        params: Promise.resolve({ id: "7", versionId: "9" }),
    });
}

let warn: jest.SpyInstance;
beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockServer.NEXT_PUBLIC_S3_ENDPOINT = "http://s3:8333";
    mockServer.S3_BUCKET_NAME = "files";
    delete mockServer.S3_PUBLIC_ENDPOINT;
    mockPermission.mockResolvedValue({
        success: true,
        data: { companyId: BigInt(1), authUserId: "user1", documentScope: async () => ({}) },
    });
    mockRowDelete.mockResolvedValue(undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

it.each(["deleted", "not_found"])(
    "removes the version row when storage reports %s",
    async outcome => {
        mockDeleteStoredObjects.mockImplementation((refs: unknown[]) =>
            Promise.resolve([{ ref: refs[0], outcome }])
        );
        expect((await call()).status).toBe(200);
        expect(mockDeleteStoredObjects).toHaveBeenCalledWith([
            { adapter: "database", storageLocationId: "database:file_uploads", key: "42" },
        ]);
        expect(mockRowDelete).toHaveBeenCalledTimes(1);
    }
);

it.each(["blocked", "retryable"])(
    "retains the version row and returns 502 for %s",
    async outcome => {
        mockDeleteStoredObjects.mockResolvedValue([{ outcome, errorCode: "provider_failure" }]);
        const response = await call();
        expect(response.status).toBe(502);
        expect((await response.json()).details).toBe("provider_failure");
        expect(mockRowDelete).not.toHaveBeenCalled();
    }
);

it("retains an unrecognized URL instead of pretending its bytes were deleted", async () => {
    const response = await call("https://foreign.example/file.pdf");
    expect(response.status).toBe(502);
    expect((await response.json()).details).toContain("unrecognized");
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).not.toHaveBeenCalled();
});

it("retains an ambiguous URL instead of choosing a provider", async () => {
    mockServer.S3_PUBLIC_ENDPOINT = "https://app1.ufs.sh";
    const response = await call("https://app1.ufs.sh/f/key");
    expect(response.status).toBe(502);
    expect((await response.json()).details).toContain("ambiguous");
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).not.toHaveBeenCalled();
});
