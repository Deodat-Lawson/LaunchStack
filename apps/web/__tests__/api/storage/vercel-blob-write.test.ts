jest.mock("@vercel/blob", () => ({ put: jest.fn() }));

jest.mock("~/env", () => ({
    env: { server: { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_TestStore_secret" } },
}));

jest.mock("~/server/storage/ledger", () => ({ recordStoredObject: jest.fn() }));
jest.mock("~/server/storage/delete-objects", () => ({ deleteStoredObjects: jest.fn() }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));

import { put } from "@vercel/blob";
import { StorageError } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import { deleteStoredObjects } from "~/server/storage/delete-objects";
import { recordStoredObject } from "~/server/storage/ledger";
import { putFile } from "~/server/storage/vercel-blob";

const mockDb = {};
const ref = {
    adapter: "vercel-blob",
    storageLocationId: "vercel-blob:teststore",
    key: "documents/provider-file.txt",
} as const;
const providerResult = {
    url: "https://teststore.public.blob.vercel-storage.com/documents/provider-file.txt",
    pathname: ref.key,
    contentType: "text/plain",
    contentDisposition: "inline",
    downloadUrl:
        "https://teststore.public.blob.vercel-storage.com/documents/provider-file.txt?download=1",
    contentHash: "provider-checksum",
};

beforeEach(() => {
    jest.resetAllMocks();
    (getEngine as jest.Mock).mockReturnValue({ db: mockDb });
    (put as jest.Mock).mockResolvedValue(providerResult);
    (recordStoredObject as jest.Mock).mockResolvedValue(undefined);
    (deleteStoredObjects as jest.Mock).mockResolvedValue([{ ref, outcome: "deleted" }]);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("putFile durable object writes", () => {
    it("records the provider identity, tenant, exact byte length, type, and checksum before returning", async () => {
        const data = new Uint8Array([0, 65, 66, 0]).subarray(1, 3);
        const result = await putFile({
            filename: "example.txt",
            data,
            companyId: BigInt(42),
            contentType: "text/plain",
        });

        expect(put).toHaveBeenCalledWith(
            expect.stringMatching(/^documents\/.+-example\.txt$/),
            Buffer.from([65, 66]),
            {
                access: "public",
                contentType: "text/plain",
                token: "vercel_blob_rw_TestStore_secret",
            }
        );
        expect(recordStoredObject).toHaveBeenCalledWith(mockDb, {
            ref,
            url: providerResult.url,
            companyId: BigInt(42),
            source: "vercel-blob",
            contentType: "text/plain",
            sizeBytes: 2,
            checksum: "provider-checksum",
        });
        expect(result).toEqual({
            url: providerResult.url,
            pathname: ref.key,
            ref,
            contentType: "text/plain",
            checksum: "provider-checksum",
        });
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("records an explicitly unowned object and a missing provider checksum as null", async () => {
        (put as jest.Mock).mockResolvedValue({ ...providerResult, contentHash: undefined });

        await putFile({ filename: "example.txt", data: new ArrayBuffer(3), companyId: null });

        expect(recordStoredObject).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({ companyId: null, checksum: null, sizeBytes: 3 })
        );
    });

    it.each(["deleted", "not_found"])(
        "deletes the unrecorded object and rejects with the ledger error when cleanup is %s",
        async outcome => {
            const ledgerError = new Error("ledger unavailable");
            (recordStoredObject as jest.Mock).mockRejectedValue(ledgerError);
            (deleteStoredObjects as jest.Mock).mockResolvedValue([{ ref, outcome }]);
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

            const write = putFile({
                filename: "example.txt",
                data: Buffer.from("contents"),
                companyId: BigInt(42),
            });

            await expect(write).rejects.toBeInstanceOf(StorageError);
            await expect(write).rejects.toMatchObject({
                provider: "vercel-blob",
                cause: ledgerError,
                message: "[vercel-blob] ledger unavailable",
            });
            expect(deleteStoredObjects).toHaveBeenCalledWith([ref]);
            expect(warn).not.toHaveBeenCalled();
        }
    );

    it.each(["blocked", "retryable"])(
        "warns when compensation is %s without replacing the ledger error",
        async outcome => {
            const ledgerError = new Error("ledger unavailable");
            const results = [{ ref, outcome }];
            (recordStoredObject as jest.Mock).mockRejectedValue(ledgerError);
            (deleteStoredObjects as jest.Mock).mockResolvedValue(results);
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

            await expect(
                putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
            ).rejects.toMatchObject({ cause: ledgerError, provider: "vercel-blob" });

            expect(deleteStoredObjects).toHaveBeenCalledWith([ref]);
            expect(warn).toHaveBeenCalledWith(
                "Failed to compensate unrecorded Vercel Blob upload",
                results
            );
        }
    );

    it("warns when compensation throws and preserves the ledger error", async () => {
        const ledgerError = new Error("ledger unavailable");
        const cleanupError = new Error("provider unavailable");
        (recordStoredObject as jest.Mock).mockRejectedValue(ledgerError);
        (deleteStoredObjects as jest.Mock).mockRejectedValue(cleanupError);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await expect(
            putFile({ filename: "example.txt", data: Buffer.from("x"), companyId: null })
        ).rejects.toMatchObject({ cause: ledgerError, provider: "vercel-blob" });

        expect(warn).toHaveBeenCalledWith(
            "Failed to compensate unrecorded Vercel Blob upload",
            cleanupError
        );
    });
});
