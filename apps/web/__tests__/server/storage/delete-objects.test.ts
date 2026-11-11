/** @jest-environment node */

const mockServer: Record<string, string | undefined> = {};
const mockSend = jest.fn();
const mockBlobDel = jest.fn();
const mockUtDeleteFiles = jest.fn();
const mockReturning = jest.fn();
const mockWhere = jest.fn(() => ({ returning: mockReturning }));
const mockDbDelete = jest.fn(() => ({ where: mockWhere }));

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServer };
    },
}));
jest.mock("@aws-sdk/client-s3", () => ({
    ...jest.requireActual("@aws-sdk/client-s3"),
    S3Client: jest.fn(() => ({ send: mockSend })),
}));
jest.mock("@vercel/blob", () => ({ del: (...args: unknown[]) => mockBlobDel(...args) }));
jest.mock("uploadthing/server", () => ({
    UTApi: jest.fn(() => ({ deleteFiles: mockUtDeleteFiles })),
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: { delete: mockDbDelete } }) }));
jest.mock("@launchstack/store/schema", () => ({ fileUploads: { id: "id" } }));
jest.mock("drizzle-orm", () => ({
    inArray: (column: unknown, ids: number[]) => ({ column, ids }),
}));

import { deleteStoredObjects } from "~/server/storage/delete-objects";
import { deleteObjects as deleteS3Objects } from "~/server/storage/adapters/s3";
import { deleteObjects as deleteDatabaseObjects } from "~/server/storage/adapters/database";
import { deleteObjects as deleteBlobObjects } from "~/server/storage/adapters/vercel-blob";
import { deleteObjects as deleteUploadThingObjects } from "~/server/storage/adapters/uploadthing";
import type { ObjectRef, StorageAdapter } from "~/server/storage/object-ref";

function ref(adapter: StorageAdapter, key: string, storageLocationId?: string): ObjectRef {
    const locations = {
        s3: "s3:http://s3:8333@files",
        database: "database:file_uploads",
        "vercel-blob": "vercel-blob:store1",
        uploadthing: "uploadthing:app1",
    };
    return { adapter, key, storageLocationId: storageLocationId ?? locations[adapter] };
}

beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockServer)) delete mockServer[key];
    Object.assign(mockServer, {
        NEXT_PUBLIC_S3_ENDPOINT: "http://s3:8333",
        S3_BUCKET_NAME: "files",
        S3_ACCESS_KEY: "test",
        S3_SECRET_KEY: "secret",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store1_secret",
        UPLOADTHING_TOKEN: Buffer.from(
            JSON.stringify({ appId: "app1", apiKey: "sk_test", regions: ["iad1"] })
        ).toString("base64"),
    });
    mockSend.mockResolvedValue({ Deleted: [] });
    mockReturning.mockResolvedValue([{ id: 1 }]);
    mockBlobDel.mockResolvedValue(undefined);
    mockUtDeleteFiles.mockResolvedValue({ success: true, deletedCount: 1 });
});

it("restores mixed-provider results to input order, including blocked refs and duplicates", async () => {
    const inputs = [
        ref("database", "2"),
        ref("s3", "old", "s3:http://s3:8333@old-bucket"),
        ref("uploadthing", "ut-key"),
        ref("database", "1"),
        ref("vercel-blob", "blob-key"),
        ref("database", "1"),
    ];
    const results = await deleteStoredObjects(inputs);
    expect(results).toEqual(
        inputs.map((input, index) => ({
            ref: input,
            outcome: index === 0 ? "not_found" : index === 1 ? "blocked" : "deleted",
            ...(index === 1 ? { errorCode: "storage_location_mismatch" } : {}),
        }))
    );
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
});

it.each(["s3", "vercel-blob", "uploadthing"] as const)(
    "blocks unconfigured %s without sending anything",
    async adapter => {
        delete mockServer.NEXT_PUBLIC_S3_ENDPOINT;
        delete mockServer.BLOB_READ_WRITE_TOKEN;
        delete mockServer.UPLOADTHING_TOKEN;
        const input = ref(adapter, "key");
        expect(await deleteStoredObjects([input])).toEqual([
            { ref: input, outcome: "blocked", errorCode: "storage_unconfigured" },
        ]);
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockBlobDel).not.toHaveBeenCalled();
        expect(mockUtDeleteFiles).not.toHaveBeenCalled();
    }
);

it("does not send mismatched locations to any provider", async () => {
    const inputs = (["s3", "database", "vercel-blob", "uploadthing"] as const).map(adapter =>
        ref(adapter, "1", "other-location")
    );
    expect(await deleteStoredObjects(inputs)).toEqual(
        inputs.map(input => ({
            ref: input,
            outcome: "blocked",
            errorCode: "storage_location_mismatch",
        }))
    );
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockBlobDel).not.toHaveBeenCalled();
    expect(mockUtDeleteFiles).not.toHaveBeenCalled();
});

describe("S3", () => {
    it("chunks 1001 keys into non-quiet batches of at most 1000", async () => {
        const inputs = Array.from({ length: 1001 }, (_, i) => ref("s3", `key-${i}`));
        expect(await deleteS3Objects(inputs)).toEqual(
            inputs.map(input => ({ ref: input, outcome: "deleted" }))
        );
        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(mockSend.mock.calls[0]?.[0].input).toEqual({
            Bucket: "files",
            Delete: {
                Quiet: false,
                Objects: inputs.slice(0, 1000).map(input => ({ Key: input.key })),
            },
        });
        expect(mockSend.mock.calls[1]?.[0].input.Delete.Objects).toEqual([{ Key: "key-1000" }]);
    });

    it("classifies per-key errors without confusing deleted or absent keys", async () => {
        mockSend.mockResolvedValue({
            Deleted: [{ Key: "ok" }, { Key: "absent" }],
            Errors: [
                { Key: "denied", Code: "AccessDenied", Message: "denied" },
                { Key: "busy", Code: "SlowDown" },
                { Key: "missing", Code: "NoSuchKey" },
            ],
        });
        const inputs = ["busy", "ok", "denied", "absent", "missing"].map(key => ref("s3", key));
        expect(
            (await deleteS3Objects(inputs)).map(result => [
                result.ref.key,
                result.outcome,
                result.errorCode,
            ])
        ).toEqual([
            ["busy", "retryable", "SlowDown"],
            ["ok", "deleted", undefined],
            ["denied", "blocked", "AccessDenied"],
            ["absent", "deleted", undefined],
            ["missing", "retryable", "NoSuchKey"],
        ]);
    });

    it.each([
        "AccessDenied",
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
        "ExpiredToken",
        "NoSuchBucket",
    ])("blocks whole-call configuration error %s", async code => {
        mockSend.mockRejectedValue(Object.assign(new Error(code), { name: code }));
        expect((await deleteS3Objects([ref("s3", "key")]))[0]).toMatchObject({
            outcome: "blocked",
            errorCode: code,
        });
    });

    it("classifies HTTP 403 as blocked and network errors as retryable", async () => {
        mockSend
            .mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } })
            .mockRejectedValueOnce(new Error("ECONNRESET"));
        expect((await deleteS3Objects([ref("s3", "key")]))[0]?.outcome).toBe("blocked");
        expect((await deleteS3Objects([ref("s3", "key")]))[0]?.outcome).toBe("retryable");
    });
});

describe("database", () => {
    it("deletes once and distinguishes found, missing, invalid and mismatched refs in order", async () => {
        const inputs = [
            ref("database", "2"),
            ref("database", "bad"),
            ref("database", "1"),
            ref("database", "3", "database:other"),
        ];
        expect(await deleteDatabaseObjects(inputs)).toEqual([
            { ref: inputs[0], outcome: "not_found" },
            { ref: inputs[1], outcome: "blocked", errorCode: "invalid_key" },
            { ref: inputs[2], outcome: "deleted" },
            { ref: inputs[3], outcome: "blocked", errorCode: "storage_location_mismatch" },
        ]);
        expect(mockDbDelete).toHaveBeenCalledTimes(1);
        expect(mockWhere).toHaveBeenCalledWith({ column: "id", ids: [2, 1] });
    });

    it("reports database errors as retryable without throwing", async () => {
        mockReturning.mockRejectedValue(new Error("connection closed"));
        expect((await deleteDatabaseObjects([ref("database", "1")]))[0]).toMatchObject({
            outcome: "retryable",
            message: "connection closed",
        });
    });
});

describe("UploadThing", () => {
    it("falls back from a partial batch to individual deletes to identify missing keys", async () => {
        mockUtDeleteFiles
            .mockResolvedValueOnce({ success: true, deletedCount: 1 })
            .mockResolvedValueOnce({ success: true, deletedCount: 1 })
            .mockResolvedValueOnce({ success: true, deletedCount: 0 });
        const inputs = [ref("uploadthing", "present"), ref("uploadthing", "missing")];
        expect(await deleteUploadThingObjects(inputs)).toEqual([
            { ref: inputs[0], outcome: "deleted" },
            { ref: inputs[1], outcome: "not_found" },
        ]);
        expect(mockUtDeleteFiles.mock.calls.map(call => call[0])).toEqual([
            ["present", "missing"],
            "present",
            "missing",
        ]);
    });

    it("classifies authentication failures as blocked", async () => {
        mockUtDeleteFiles.mockRejectedValue(
            Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" })
        );
        expect((await deleteUploadThingObjects([ref("uploadthing", "key")]))[0]?.outcome).toBe(
            "blocked"
        );
    });

    it("does not mistake success:false for a missing object", async () => {
        mockUtDeleteFiles.mockResolvedValue({ success: false, deletedCount: 0 });
        expect((await deleteUploadThingObjects([ref("uploadthing", "key")]))[0]?.outcome).toBe(
            "retryable"
        );
    });
});

describe("Vercel Blob", () => {
    it("blocks a missing token", async () => {
        delete mockServer.BLOB_READ_WRITE_TOKEN;
        expect(await deleteBlobObjects([ref("vercel-blob", "key")])).toEqual([
            {
                ref: ref("vercel-blob", "key"),
                outcome: "blocked",
                errorCode: "storage_unconfigured",
            },
        ]);
        expect(mockBlobDel).not.toHaveBeenCalled();
    });

    it("chunks pathnames and reports successful deletion, even if a blob was absent", async () => {
        const inputs = Array.from({ length: 1001 }, (_, i) => ref("vercel-blob", `key-${i}`));
        expect(
            (await deleteBlobObjects(inputs)).every(result => result.outcome === "deleted")
        ).toBe(true);
        expect(mockBlobDel).toHaveBeenCalledTimes(2);
        expect(mockBlobDel.mock.calls[0]?.[0]).toHaveLength(1000);
        expect(mockBlobDel.mock.calls[1]).toEqual([
            ["key-1000"],
            { token: "vercel_blob_rw_store1_secret" },
        ]);
    });

    it.each([
        ["store not found", "blocked"],
        ["store suspended", "blocked"],
        ["invalid token", "blocked"],
        ["connection reset", "retryable"],
    ])("classifies %s as %s", async (message, outcome) => {
        mockBlobDel.mockRejectedValue(new Error(message));
        expect((await deleteBlobObjects([ref("vercel-blob", "key")]))[0]?.outcome).toBe(outcome);
    });
});
