jest.mock("@vercel/blob", () => ({ put: jest.fn() }));
jest.mock("node:crypto", () => ({
    ...jest.requireActual("node:crypto"),
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
}));
jest.mock("~/env", () => ({
    env: {
        server: {
            BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_TestStore_secret",
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example.com/",
            S3_PUBLIC_ENDPOINT: "https://files.example.com",
            S3_BUCKET_NAME: "documents",
        },
    },
}));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: jest.fn(),
    removeStoredObject: jest.fn(),
}));
jest.mock("~/server/storage/compensate", () => ({ discardUnrecordedObject: jest.fn() }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));

import { put } from "@vercel/blob";
import { StorageError } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import { discardUnrecordedObject } from "~/server/storage/compensate";
import { recordStoredObject, removeStoredObject } from "~/server/storage/ledger";
import { refFromStoredUrl } from "~/server/storage/stored-url";
import { putFile } from "~/server/storage/vercel-blob";

const mockWhere = jest.fn();
const mockSet = jest.fn();
const mockDb = { update: jest.fn() };
const ref = {
    adapter: "vercel-blob",
    storageLocationId: "vercel-blob:teststore",
    key: "documents/12345678-1234-1234-1234-123456789abc-example.txt",
} as const;
const providerResult = {
    url: `https://teststore.public.blob.vercel-storage.com/${ref.key}`,
    pathname: ref.key,
    contentType: "text/plain",
    contentDisposition: "inline",
    downloadUrl: `https://teststore.public.blob.vercel-storage.com/${ref.key}?download=1`,
    contentHash: "provider-checksum",
    etag: '"provider-etag"',
};

beforeEach(() => {
    jest.resetAllMocks();
    (getEngine as jest.Mock).mockReturnValue({ db: mockDb });
    mockDb.update.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
    (put as jest.Mock).mockResolvedValue(providerResult);
    (recordStoredObject as jest.Mock).mockResolvedValue(undefined);
    (removeStoredObject as jest.Mock).mockResolvedValue(undefined);
    (discardUnrecordedObject as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("putFile write-ahead object inventory", () => {
    it("records the deterministic public identity and exact bytes before put, then finalizes provider metadata", async () => {
        const data = new Uint8Array([0, 65, 66, 0]).subarray(1, 3);
        const result = await putFile({
            filename: "example.txt",
            data,
            companyId: BigInt(42),
            contentType: "text/plain",
        });

        expect(recordStoredObject).toHaveBeenCalledWith(mockDb, {
            ref,
            url: providerResult.url,
            companyId: BigInt(42),
            source: "vercel-blob",
            contentType: "text/plain",
            sizeBytes: 2,
            checksum: null,
        });
        expect((recordStoredObject as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            (put as jest.Mock).mock.invocationCallOrder[0]!
        );
        expect(put).toHaveBeenCalledWith(ref.key, Buffer.from([65, 66]), {
            access: "public",
            addRandomSuffix: false,
            contentType: "text/plain",
            token: "vercel_blob_rw_TestStore_secret",
        });
        expect(mockSet).toHaveBeenCalledWith({
            url: providerResult.url,
            contentType: "text/plain",
            checksum: "provider-checksum",
        });
        expect((put as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            mockWhere.mock.invocationCallOrder[0]!
        );
        expect(result).toEqual({
            url: providerResult.url,
            pathname: ref.key,
            ref,
            contentType: "text/plain",
            checksum: "provider-checksum",
        });
        const recordedRef = (recordStoredObject as jest.Mock).mock.calls[0]![1].ref;
        expect(refFromStoredUrl(result.url)).toEqual({ ok: true, ref: recordedRef });
        expect(discardUnrecordedObject).not.toHaveBeenCalled();
        expect(removeStoredObject).not.toHaveBeenCalled();
    });

    it("preserves unowned ArrayBuffer byte length and the SDK's returned etag", async () => {
        (put as jest.Mock).mockResolvedValue({ ...providerResult, contentHash: undefined });

        const result = await putFile({
            filename: "example.txt",
            data: new ArrayBuffer(3),
            companyId: null,
        });

        expect(recordStoredObject).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({ companyId: null, checksum: null, sizeBytes: 3 })
        );
        expect(mockSet).toHaveBeenCalledWith({
            url: providerResult.url,
            contentType: "text/plain",
            checksum: providerResult.etag,
        });
        expect(result.checksum).toBe(providerResult.etag);
    });

    it("does not put or compensate when the write-ahead insert fails", async () => {
        const ledgerError = new Error("ledger unavailable");
        (recordStoredObject as jest.Mock).mockRejectedValue(ledgerError);

        const write = putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null });

        await expect(write).rejects.toBeInstanceOf(StorageError);
        await expect(write).rejects.toMatchObject({ cause: ledgerError, provider: "vercel-blob" });
        expect(put).not.toHaveBeenCalled();
        expect(discardUnrecordedObject).not.toHaveBeenCalled();
        expect(removeStoredObject).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("cleans up a failed put before removing inventory and preserves the provider error", async () => {
        const providerError = new Error("connection lost after write");
        (put as jest.Mock).mockRejectedValue(providerError);

        await expect(
            putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
        ).rejects.toBe(providerError);

        expect(discardUnrecordedObject).toHaveBeenCalledWith(
            ref,
            "Failed to compensate Vercel Blob upload"
        );
        expect(removeStoredObject).toHaveBeenCalledWith(mockDb, ref);
        expect((put as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            (discardUnrecordedObject as jest.Mock).mock.invocationCallOrder[0]!
        );
        expect((discardUnrecordedObject as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
            (removeStoredObject as jest.Mock).mock.invocationCallOrder[0]!
        );
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("keeps inventory when the cleanup helper cannot confirm provider deletion", async () => {
        const providerError = new Error("connection lost after write");
        (put as jest.Mock).mockRejectedValue(providerError);
        (discardUnrecordedObject as jest.Mock).mockResolvedValue(false);

        await expect(
            putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
        ).rejects.toBe(providerError);

        expect(discardUnrecordedObject).toHaveBeenCalledWith(ref, expect.any(String));
        expect(removeStoredObject).not.toHaveBeenCalled();
    });

    it("does not replace the provider error if compensated ledger removal fails", async () => {
        const providerError = new Error("put failed");
        const removalError = new Error("ledger unavailable");
        (put as jest.Mock).mockRejectedValue(providerError);
        (removeStoredObject as jest.Mock).mockRejectedValue(removalError);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await expect(
            putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
        ).rejects.toBe(providerError);

        expect(warn).toHaveBeenCalledWith(
            "Failed to remove compensated Vercel Blob ledger entry",
            removalError
        );
    });

    it.each([true, false])(
        "compensates final metadata failure and removes inventory only when confirmed (%s)",
        async confirmed => {
            const ledgerError = new Error("metadata unavailable");
            mockWhere.mockRejectedValue(ledgerError);
            (discardUnrecordedObject as jest.Mock).mockResolvedValue(confirmed);

            await expect(
                putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
            ).rejects.toMatchObject({ cause: ledgerError, provider: "vercel-blob" });

            expect(discardUnrecordedObject).toHaveBeenCalledWith(ref, expect.any(String));
            expect(mockWhere.mock.invocationCallOrder[0]).toBeLessThan(
                (discardUnrecordedObject as jest.Mock).mock.invocationCallOrder[0]!
            );
            if (confirmed) expect(removeStoredObject).toHaveBeenCalledWith(mockDb, ref);
            else expect(removeStoredObject).not.toHaveBeenCalled();
        }
    );
});
