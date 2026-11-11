import { POST } from "~/app/api/storage/upload/route";
import { fileUploads } from "@launchstack/store/schema";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockWorkspaceContext = jest.fn();
const mockPutObject = jest.fn();
const mockEnsureBucketExists = jest.fn();
const mockValues = jest.fn();
const mockInsert = jest.fn(() => ({ values: mockValues }));
const mockTx = { insert: mockInsert };
const mockTransaction = jest.fn();
const mockRecordStoredObject = jest.fn();
const mockDeleteStoredObjects = jest.fn();
const mockIsS3Storage = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockWorkspaceContext(),
}));
jest.mock("~/server/engine", () => ({
    getEngine: () => ({ db: { transaction: (...args: unknown[]) => mockTransaction(...args) } }),
}));
jest.mock("~/lib/storage", () => ({ isS3Storage: () => mockIsS3Storage() }));
jest.mock("~/server/storage/s3-client", () => ({
    putObject: (...args: unknown[]) => mockPutObject(...args),
    ensureBucketExists: () => mockEnsureBucketExists(),
    getS3BucketName: () => "documents",
    getObjectUrl: (key: string) => `https://s3.example/documents/${key}`,
}));
jest.mock("~/server/storage/location", () => ({
    currentStorageLocationId: () => "s3:https://s3.internal@documents",
}));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: (...args: unknown[]) => mockRecordStoredObject(...args),
}));
jest.mock("~/server/storage/delete-objects", () => ({
    deleteStoredObjects: (...args: unknown[]) => mockDeleteStoredObjects(...args),
}));

function multipart() {
    const form = new FormData();
    form.append("file", new File(["memo"], "memo.pdf", { type: "application/pdf" }));
    return new Request("http://localhost/api/storage/upload", { method: "POST", body: form });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
    mockIsS3Storage.mockReturnValue(true);
    mockPutObject.mockResolvedValue(undefined);
    mockEnsureBucketExists.mockResolvedValue(undefined);
    mockValues.mockResolvedValue(undefined);
    mockRecordStoredObject.mockResolvedValue(undefined);
    mockDeleteStoredObjects.mockResolvedValue([{ outcome: "deleted" }]);
    mockTransaction.mockImplementation((work: (tx: typeof mockTx) => Promise<void>) =>
        work(mockTx)
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it("records file ownership and the durable object in the same transaction", async () => {
    const response = await POST(multipart());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { objectKey: string; bucket: string; url: string };
    expect(body).toEqual({
        objectKey: expect.stringMatching(/^documents\/.+-memo\.pdf$/),
        bucket: "documents",
        url: `https://s3.example/documents/${body.objectKey}`,
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(fileUploads);
    expect(mockValues).toHaveBeenCalledWith({
        userId: "user-a",
        companyId: BigInt(5),
        filename: "memo.pdf",
        mimeType: "application/pdf",
        fileSize: 4,
        storageProvider: "s3",
        storageUrl: body.url,
        storagePathname: body.objectKey,
    });
    expect(mockRecordStoredObject).toHaveBeenCalledWith(mockTx, {
        ref: {
            adapter: "s3",
            storageLocationId: "s3:https://s3.internal@documents",
            key: body.objectKey,
        },
        url: body.url,
        companyId: BigInt(5),
        source: "storage-upload-route",
        contentType: "application/pdf",
        sizeBytes: 4,
    });
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
});

it.each(["ownership insert", "ledger insert", "transaction commit"])(
    "compensates a failed %s and preserves the error response",
    async failure => {
        if (failure === "ownership insert")
            mockValues.mockRejectedValueOnce(new Error("record failed"));
        if (failure === "ledger insert")
            mockRecordStoredObject.mockRejectedValueOnce(new Error("record failed"));
        if (failure === "transaction commit")
            mockTransaction.mockImplementationOnce(
                async (work: (tx: typeof mockTx) => Promise<void>) => {
                    await work(mockTx);
                    throw new Error("record failed");
                }
            );
        const response = await POST(multipart());
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            error: expect.any(String),
            details: "record failed",
        });
        const key = mockPutObject.mock.calls[0]![0] as string;
        expect(mockDeleteStoredObjects).toHaveBeenCalledWith([
            {
                adapter: "s3",
                storageLocationId: "s3:https://s3.internal@documents",
                key,
            },
        ]);
    }
);

it.each(["blocked", "retryable", "throw"])(
    "warns when compensation fails with %s without masking the insert failure",
    async outcome => {
        mockRecordStoredObject.mockRejectedValueOnce(new Error("record failed"));
        if (outcome === "throw")
            mockDeleteStoredObjects.mockRejectedValueOnce(new Error("delete failed"));
        else mockDeleteStoredObjects.mockResolvedValueOnce([{ outcome }]);
        const response = await POST(multipart());
        expect(response.status).toBe(500);
        expect(((await response.json()) as { details: string }).details).toBe("record failed");
        expect(console.warn).toHaveBeenCalled();
    }
);

it("does not attempt recording or compensation when the object write fails", async () => {
    mockPutObject.mockRejectedValueOnce(new Error("write failed"));
    const response = await POST(multipart());
    expect(response.status).toBe(500);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
});
