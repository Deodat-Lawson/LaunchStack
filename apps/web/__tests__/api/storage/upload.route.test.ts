import { POST } from "~/app/api/storage/upload/route";
import { fileUploads } from "@launchstack/store/schema";
import { refFromStoredUrl } from "~/server/storage/stored-url";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockWorkspaceContext = jest.fn();
const mockPutObject = jest.fn();
const mockEnsureBucketExists = jest.fn();
const mockValues = jest.fn();
const mockInsert = jest.fn(() => ({ values: mockValues }));
const mockDb = { insert: mockInsert };
const mockRecordStoredObject = jest.fn();
const mockRemoveStoredObject = jest.fn();
const mockDiscardUnrecordedObject = jest.fn();
const mockIsS3Storage = jest.fn();

jest.mock("~/env", () => ({
    env: {
        server: {
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.internal/objects/",
            S3_PUBLIC_ENDPOINT: "https://files.example/objects/",
            S3_BUCKET_NAME: "documents",
        },
    },
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockWorkspaceContext(),
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockDb }) }));
jest.mock("~/lib/storage", () => ({ isS3Storage: () => mockIsS3Storage() }));
jest.mock("~/server/storage/s3-client", () => ({
    ...jest.requireActual("~/server/storage/s3-client"),
    putObject: (...args: unknown[]) => mockPutObject(...args),
    ensureBucketExists: () => mockEnsureBucketExists(),
}));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: (...args: unknown[]) => mockRecordStoredObject(...args),
    removeStoredObject: (...args: unknown[]) => mockRemoveStoredObject(...args),
}));
jest.mock("~/server/storage/compensate", () => ({
    discardUnrecordedObject: (...args: unknown[]) => mockDiscardUnrecordedObject(...args),
}));

function multipart() {
    const form = new FormData();
    form.append("file", new File(["memo"], "memo.pdf", { type: "application/pdf" }));
    return new Request("http://localhost/api/storage/upload", { method: "POST", body: form });
}
beforeEach(() => {
    jest.resetAllMocks();
    mockInsert.mockImplementation(() => ({ values: mockValues }));
    mockWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
    mockIsS3Storage.mockReturnValue(true);
    mockPutObject.mockResolvedValue(undefined);
    mockEnsureBucketExists.mockResolvedValue(undefined);
    mockValues.mockResolvedValue(undefined);
    mockRecordStoredObject.mockResolvedValue(undefined);
    mockRemoveStoredObject.mockResolvedValue(undefined);
    mockDiscardUnrecordedObject.mockResolvedValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("commits the ledger before S3 bytes, then ownership, with a round-trippable ref", async () => {
    const response = await POST(multipart());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { objectKey: string; bucket: string; url: string };
    const ref = {
        adapter: "s3",
        storageLocationId: "s3:https://s3.internal/objects@documents",
        key: body.objectKey,
    };
    expect(body).toEqual({
        objectKey: expect.stringMatching(/^documents\/.+-memo\.pdf$/),
        bucket: "documents",
        url: `https://s3.internal/objects/documents/${body.objectKey}`,
    });
    expect(mockInsert).toHaveBeenCalledWith(fileUploads);
    expect(mockValues).toHaveBeenCalledWith({
        userId: "user-a",
        companyId: 5n,
        filename: "memo.pdf",
        mimeType: "application/pdf",
        fileSize: 4,
        storageProvider: "s3",
        storageUrl: body.url,
        storagePathname: body.objectKey,
    });
    expect(mockRecordStoredObject).toHaveBeenCalledWith(mockDb, {
        ref,
        url: body.url,
        companyId: 5n,
        source: "storage-upload-route",
        contentType: "application/pdf",
        sizeBytes: 4,
    });
    expect(refFromStoredUrl(body.url)).toEqual({ ok: true, ref });
    expect(refFromStoredUrl(body.url.replace("s3.internal", "files.example"))).toEqual({
        ok: true,
        ref,
    });
    expect(mockRecordStoredObject.mock.invocationCallOrder[0]).toBeLessThan(
        mockPutObject.mock.invocationCallOrder[0]!
    );
    expect(mockPutObject.mock.invocationCallOrder[0]).toBeLessThan(
        mockInsert.mock.invocationCallOrder[0]!
    );
    expect(mockDiscardUnrecordedObject).not.toHaveBeenCalled();
});

it("does not write bytes or ownership when the ledger insert fails", async () => {
    mockRecordStoredObject.mockRejectedValueOnce(new Error("ledger failed"));
    const response = await POST(multipart());
    expect(response.status).toBe(500);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDiscardUnrecordedObject).not.toHaveBeenCalled();
});

it.each(["put", "ownership"])(
    "compensates a failed %s and removes the ledger only after deletion",
    async failure => {
        if (failure === "put") mockPutObject.mockRejectedValueOnce(new Error("write failed"));
        else mockValues.mockRejectedValueOnce(new Error("write failed"));
        const response = await POST(multipart());
        expect(response.status).toBe(500);
        expect(((await response.json()) as { details: string }).details).toBe("write failed");
        const ref = mockRecordStoredObject.mock.calls[0]![1].ref;
        expect(mockDiscardUnrecordedObject).toHaveBeenCalledWith(ref, expect.any(String));
        expect(mockRemoveStoredObject).toHaveBeenCalledWith(mockDb, ref);
        expect(mockDiscardUnrecordedObject.mock.invocationCallOrder[0]).toBeLessThan(
            mockRemoveStoredObject.mock.invocationCallOrder[0]!
        );
        if (failure === "put") expect(mockInsert).not.toHaveBeenCalled();
    }
);

it("retains the ledger when provider cleanup is unconfirmed", async () => {
    mockValues.mockRejectedValueOnce(new Error("ownership failed"));
    mockDiscardUnrecordedObject.mockResolvedValueOnce(false);
    expect((await POST(multipart())).status).toBe(500);
    expect(mockRemoveStoredObject).not.toHaveBeenCalled();
});

it("preserves the write error if ledger-row cleanup fails", async () => {
    mockPutObject.mockRejectedValueOnce(new Error("write failed"));
    mockRemoveStoredObject.mockRejectedValueOnce(new Error("ledger delete failed"));
    const response = await POST(multipart());
    expect(((await response.json()) as { details: string }).details).toBe("write failed");
    expect(console.warn).toHaveBeenCalled();
});
