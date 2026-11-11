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

import { UTApi } from "uploadthing/server";

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
    mockSend.mockImplementation(async command => ({ Deleted: command.input.Delete.Objects }));
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

    it.each([[undefined], [[]], [[{ Key: "other" }]]])(
        "keeps keys without a Deleted acknowledgement retryable (%j)",
        async deleted => {
            mockSend.mockResolvedValue({ Deleted: deleted });
            const input = ref("s3", "unacknowledged");
            expect(await deleteS3Objects([input])).toEqual([
                { ref: input, outcome: "retryable", errorCode: "s3_delete_unconfirmed" },
            ]);
        }
    );

    it("requires acknowledgements per key while preserving duplicate occurrences", async () => {
        mockSend.mockResolvedValue({
            Deleted: [{ Key: "ok" }, { Key: "denied" }],
            Errors: [{ Key: "denied", Code: "AccessDenied" }],
        });
        const inputs = ["ok", "unknown", "ok", "denied"].map(key => ref("s3", key));
        expect((await deleteS3Objects(inputs)).map(result => result.outcome)).toEqual([
            "deleted",
            "retryable",
            "deleted",
            "blocked",
        ]);
    });

    it.each([
        ["S3_ACCESS_KEY", undefined],
        ["S3_ACCESS_KEY", ""],
        ["S3_SECRET_KEY", undefined],
        ["S3_SECRET_KEY", ""],
    ])("blocks missing credential %s (%j) before calling the SDK", async (key, value) => {
        mockServer[key] = value;
        const input = ref("s3", "key");
        expect(await deleteS3Objects([input])).toEqual([
            { ref: input, outcome: "blocked", errorCode: "storage_unconfigured" },
        ]);
        expect(mockSend).not.toHaveBeenCalled();
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

    it.each([
        [401, "blocked"],
        [403, "blocked"],
        [500, "retryable"],
    ])("classifies HTTP %i as %s", async (status, outcome) => {
        mockSend.mockRejectedValue({ $metadata: { httpStatusCode: status } });
        expect((await deleteS3Objects([ref("s3", "key")]))[0]?.outcome).toBe(outcome);
    });

    it("keeps network errors retryable", async () => {
        mockSend.mockRejectedValue(new Error("ECONNRESET"));
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
    it("chunks 501 keys into batches of at most 500 and preserves duplicates", async () => {
        mockUtDeleteFiles.mockImplementation(async keys => ({
            success: true,
            deletedCount: keys.length,
        }));
        const inputs = Array.from({ length: 501 }, (_, i) => ref("uploadthing", `key-${i % 500}`));
        expect(await deleteUploadThingObjects(inputs)).toEqual(
            inputs.map(input => ({ ref: input, outcome: "deleted" }))
        );
        expect(mockUtDeleteFiles.mock.calls.map(call => call[0])).toEqual([
            inputs.slice(0, 500).map(input => input.key),
            [inputs[500]!.key],
        ]);
    });

    it("reports already batch-deleted and never-existing keys as not_found on a partial pass", async () => {
        mockUtDeleteFiles
            .mockResolvedValueOnce({ success: true, deletedCount: 1 })
            .mockResolvedValueOnce({ success: true, deletedCount: 0 })
            .mockResolvedValueOnce({ success: true, deletedCount: 0 });
        const inputs = [ref("uploadthing", "batch-deleted"), ref("uploadthing", "never-existed")];
        expect(await deleteUploadThingObjects(inputs)).toEqual([
            { ref: inputs[0], outcome: "not_found" },
            { ref: inputs[1], outcome: "not_found" },
        ]);
        expect(mockUtDeleteFiles.mock.calls.map(call => call[0])).toEqual([
            ["batch-deleted", "never-existed"],
            "batch-deleted",
            "never-existed",
        ]);
    });

    it("classifies each partial-pass response without mistaking failures for absence", async () => {
        mockUtDeleteFiles
            .mockResolvedValueOnce({ success: true, deletedCount: 0 })
            .mockResolvedValueOnce({ success: true, deletedCount: 1 })
            .mockResolvedValueOnce({ success: false, deletedCount: 0 })
            .mockRejectedValueOnce(new Error("ECONNRESET"));
        const inputs = ["deleted", "failed", "network"].map(key => ref("uploadthing", key));
        expect((await deleteUploadThingObjects(inputs)).map(result => result.outcome)).toEqual([
            "deleted",
            "retryable",
            "retryable",
        ]);
        expect(mockUtDeleteFiles).toHaveBeenCalledTimes(4);
    });

    it.each([
        [401, "blocked"],
        [403, "blocked"],
        [500, "retryable"],
    ])(
        "classifies ResponseError HTTP %i as %s without a per-key fallback",
        async (status, outcome) => {
            // UploadThing's Effect ResponseError keeps HTTP status on response,
            // not status/statusCode; its message does not name auth failures.
            const error = Object.assign(
                new Error(
                    `StatusCode: non 2xx status code (${status} POST https://api.uploadthing.com/v6/deleteFiles)`
                ),
                {
                    name: "ResponseError",
                    _tag: "ResponseError",
                    reason: "StatusCode",
                    request: { method: "POST", url: "https://api.uploadthing.com/v6/deleteFiles" },
                    response: { status },
                }
            );
            mockUtDeleteFiles.mockRejectedValue(error);
            const inputs = [ref("uploadthing", "one"), ref("uploadthing", "two")];
            expect(await deleteUploadThingObjects(inputs)).toEqual(
                inputs.map(input => ({
                    ref: input,
                    outcome,
                    errorCode: "ResponseError",
                    message: error.message,
                }))
            );
            expect(mockUtDeleteFiles).toHaveBeenCalledTimes(1);
        }
    );

    it("classifies a thrown chunk without fallback and continues with the next chunk", async () => {
        mockUtDeleteFiles
            .mockRejectedValueOnce(new Error("ECONNRESET"))
            .mockResolvedValueOnce({ success: true, deletedCount: 1 });
        const inputs = Array.from({ length: 501 }, (_, i) => ref("uploadthing", `key-${i}`));
        expect((await deleteUploadThingObjects(inputs)).map(result => result.outcome)).toEqual([
            ...Array.from({ length: 500 }, () => "retryable"),
            "deleted",
        ]);
        expect(mockUtDeleteFiles.mock.calls.map(call => call[0])).toEqual([
            inputs.slice(0, 500).map(input => input.key),
            [inputs[500]!.key],
        ]);
    });

    it("classifies client construction failures without sending deletes", async () => {
        jest.mocked(UTApi).mockImplementationOnce(() => {
            throw new Error("invalid token");
        });
        expect((await deleteUploadThingObjects([ref("uploadthing", "key")]))[0]?.outcome).toBe(
            "blocked"
        );
        expect(mockUtDeleteFiles).not.toHaveBeenCalled();
    });

    it("classifies authentication failures as blocked", async () => {
        mockUtDeleteFiles.mockRejectedValue(
            Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" })
        );
        expect((await deleteUploadThingObjects([ref("uploadthing", "key")]))[0]?.outcome).toBe(
            "blocked"
        );
    });

    it.each([
        [false, 0],
        [false, 2],
        [true, 3],
    ])(
        "keeps non-partial response success:%s count:%i retryable without fallback",
        async (success, deletedCount) => {
            mockUtDeleteFiles.mockResolvedValue({ success, deletedCount });
            const inputs = [ref("uploadthing", "one"), ref("uploadthing", "two")];
            expect(await deleteUploadThingObjects(inputs)).toEqual(
                inputs.map(input => ({
                    ref: input,
                    outcome: "retryable",
                    errorCode: "uploadthing_delete_failed",
                }))
            );
            expect(mockUtDeleteFiles).toHaveBeenCalledTimes(1);
        }
    );
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
