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

function mockSelection() {
    const result = {
        limit: () => result,
        then: (resolve: (rows: unknown[]) => unknown) =>
            Promise.resolve(mockSelectQueue.shift() ?? []).then(resolve),
    };
    return { from: () => ({ where: () => result }) };
}
jest.mock("~/server/db", () => ({
    db: {
        select: mockSelection,
        delete: () => ({ where: mockRowDelete }),
    },
}));

import { DELETE } from "~/app/api/documents/[id]/versions/[versionId]/route";

function call(
    url = "/api/files/42",
    options: {
        sharedBy?: "document" | "version";
        owned?: boolean;
        current?: boolean;
        only?: boolean;
    } = {}
) {
    mockSelectQueue.push(
        [{ id: 7, category: "document", currentVersionId: options.current ? 9 : 10 }],
        [{ id: 9, versionNumber: 1, url }],
        options.only ? [{ id: 9 }] : [{ id: 9 }, { id: 10 }],
        options.sharedBy === "document" ? [{ id: 12 }] : [],
        options.sharedBy === "version" ? [{ id: 11 }] : [],
        options.owned === false ? [] : [{ id: 42 }]
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

it("keeps re-embed-shared bytes while deleting the obsolete version row", async () => {
    expect((await call("/api/files/42", { sharedBy: "version" })).status).toBe(200);
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).toHaveBeenCalledTimes(1);
});

it("keeps bytes still referenced by a document after revert", async () => {
    expect((await call("/api/files/42", { sharedBy: "document" })).status).toBe(200);
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).toHaveBeenCalledTimes(1);
});

it("keeps a foreign-company database file while deleting the version row", async () => {
    expect((await call("/api/files/42", { owned: false })).status).toBe(200);
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).toHaveBeenCalledTimes(1);
});

it.each([{ current: true }, { only: true }])("preserves the 409 guard for %j", async options => {
    expect((await call("/api/files/42", options)).status).toBe(409);
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
    expect(mockRowDelete).not.toHaveBeenCalled();
});
