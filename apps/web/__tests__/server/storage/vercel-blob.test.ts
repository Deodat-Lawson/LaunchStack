/** @jest-environment node */

jest.mock("node:crypto", () => ({
    ...jest.requireActual("node:crypto"),
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
}));
jest.mock("~/env", () => ({
    env: {
        server: {
            BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Store1_secret",
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example.com/",
            S3_PUBLIC_ENDPOINT: "https://files.example.com",
            S3_BUCKET_NAME: "documents",
        },
    },
}));
jest.mock("@vercel/blob", () => ({ put: jest.fn() }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: jest.fn(),
    removeStoredObject: jest.fn(),
}));
jest.mock("~/server/storage/compensate", () => ({ discardUnrecordedObject: jest.fn() }));

import { put } from "@vercel/blob";
import { getEngine } from "~/server/engine";
import { discardUnrecordedObject } from "~/server/storage/compensate";
import { recordStoredObject, removeStoredObject } from "~/server/storage/ledger";
import { refFromStoredUrl } from "~/server/storage/stored-url";
import type { putFile as putBlobFile } from "~/server/storage/vercel-blob";

const mockWhere = jest.fn();
const mockSet = jest.fn();
const mockDb = { update: jest.fn() };
const ref = {
    adapter: "vercel-blob",
    storageLocationId: "vercel-blob:store1",
    key: "documents/12345678-1234-1234-1234-123456789abc-notes.txt",
} as const;
const publicUrl = `https://store1.public.blob.vercel-storage.com/${ref.key}`;
const privateUrl = `https://store1.private.blob.vercel-storage.com/${ref.key}`;
let putFile: typeof putBlobFile;

beforeEach(() => {
    jest.resetAllMocks();
    (getEngine as jest.Mock).mockReturnValue({ db: mockDb });
    mockDb.update.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
    (recordStoredObject as jest.Mock).mockResolvedValue(undefined);
    (removeStoredObject as jest.Mock).mockResolvedValue(undefined);
    (discardUnrecordedObject as jest.Mock).mockResolvedValue(true);
    (put as jest.Mock)
        .mockRejectedValueOnce(new Error("Cannot use public access on a private store"))
        .mockResolvedValue({
            url: privateUrl,
            pathname: ref.key,
            contentType: "text/plain",
            etag: '"private-checksum"',
        });
    // Each test exercises initial access detection, not another test's cached mode.
    jest.isolateModules(() => {
        putFile = jest.requireActual("~/server/storage/vercel-blob").putFile;
    });
});

it("corrects the same write-ahead row to the private URL before retry and roundtrips its identity", async () => {
    const result = await putFile({
        filename: "notes.txt",
        data: Buffer.from("notes"),
        companyId: null,
        contentType: "text/plain",
    });

    expect(recordStoredObject).toHaveBeenCalledTimes(1);
    expect(recordStoredObject).toHaveBeenCalledWith(mockDb, {
        ref,
        url: publicUrl,
        companyId: null,
        source: "vercel-blob",
        contentType: "text/plain",
        sizeBytes: 5,
        checksum: null,
    });
    expect(put).toHaveBeenNthCalledWith(1, ref.key, Buffer.from("notes"), {
        access: "public",
        addRandomSuffix: false,
        contentType: "text/plain",
        token: "vercel_blob_rw_Store1_secret",
    });
    expect(put).toHaveBeenNthCalledWith(2, ref.key, Buffer.from("notes"), {
        access: "private",
        addRandomSuffix: false,
        contentType: "text/plain",
        token: "vercel_blob_rw_Store1_secret",
    });
    expect(mockSet).toHaveBeenNthCalledWith(1, { url: privateUrl });
    expect((recordStoredObject as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (put as jest.Mock).mock.invocationCallOrder[0]!
    );
    expect((put as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        mockWhere.mock.invocationCallOrder[0]!
    );
    expect(mockWhere.mock.invocationCallOrder[0]).toBeLessThan(
        (put as jest.Mock).mock.invocationCallOrder[1]!
    );
    expect(mockSet).toHaveBeenNthCalledWith(2, {
        url: privateUrl,
        contentType: "text/plain",
        checksum: '"private-checksum"',
    });
    expect(result).toEqual({
        url: privateUrl,
        pathname: ref.key,
        ref,
        contentType: "text/plain",
        checksum: '"private-checksum"',
    });
    const recordedRef = (recordStoredObject as jest.Mock).mock.calls[0]![1].ref;
    expect(refFromStoredUrl(result.url)).toEqual({ ok: true, ref: recordedRef });
    expect(removeStoredObject).not.toHaveBeenCalled();
    expect(discardUnrecordedObject).not.toHaveBeenCalled();

    await putFile({ filename: "notes.txt", data: Buffer.from("notes"), companyId: null });
    expect(recordStoredObject).toHaveBeenLastCalledWith(
        mockDb,
        expect.objectContaining({ ref, url: privateUrl })
    );
    expect((put as jest.Mock).mock.calls[2]![2]).toMatchObject({ access: "private" });
});

it("does not write privately or remove safe inventory if correcting the attempted URL fails", async () => {
    const ledgerError = new Error("ledger unavailable");
    mockWhere.mockRejectedValue(ledgerError);

    await expect(
        putFile({ filename: "notes.txt", data: Buffer.from("notes"), companyId: null })
    ).rejects.toMatchObject({ provider: "vercel-blob", cause: ledgerError });

    expect(put).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ url: privateUrl });
    expect(recordStoredObject).toHaveBeenCalledTimes(1);
    expect(removeStoredObject).not.toHaveBeenCalled();
    expect(discardUnrecordedObject).not.toHaveBeenCalled();
});

it("compensates a failed private attempt without replacing its error or losing unconfirmed inventory", async () => {
    const privateError = new Error("private write connection lost");
    (put as jest.Mock)
        .mockReset()
        .mockRejectedValueOnce(new Error("Cannot use public access on a private store"))
        .mockRejectedValueOnce(privateError);
    (discardUnrecordedObject as jest.Mock).mockResolvedValue(false);

    await expect(
        putFile({ filename: "notes.txt", data: Buffer.from("notes"), companyId: null })
    ).rejects.toBe(privateError);

    expect(put).toHaveBeenCalledTimes(2);
    expect(discardUnrecordedObject).toHaveBeenCalledTimes(1);
    expect(discardUnrecordedObject).toHaveBeenCalledWith(
        ref,
        "Failed to compensate Vercel Blob upload"
    );
    expect(mockWhere.mock.invocationCallOrder[0]).toBeLessThan(
        (put as jest.Mock).mock.invocationCallOrder[1]!
    );
    expect(removeStoredObject).not.toHaveBeenCalled();
});

it("sanitizes the UUID-prefixed pathname before recording or sending it to the SDK", async () => {
    const key = "documents/12345678-1234-1234-1234-123456789abc-my-notes.txt";
    const url = `https://store1.public.blob.vercel-storage.com/${key}`;
    (put as jest.Mock).mockReset().mockResolvedValue({
        url,
        pathname: key,
        contentType: "text/plain",
    });

    const result = await putFile({
        filename: "my notes?.txt",
        data: Buffer.from("notes"),
        companyId: null,
    });

    expect(recordStoredObject).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ ref: { ...ref, key }, url })
    );
    expect(put).toHaveBeenCalledWith(
        key,
        Buffer.from("notes"),
        expect.objectContaining({ addRandomSuffix: false })
    );
    expect(result.ref.key).toBe(key);
    expect(result.checksum).toBeNull();
    expect(refFromStoredUrl(result.url)).toEqual({ ok: true, ref: result.ref });
});
