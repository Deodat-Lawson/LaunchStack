/**
 * The engine's StoragePort adapts the runtime's upload shape to the app's
 * uploadFile. Engine code (archive expansion, image generation) stamps the
 * workspace through it, so the port must pass companyId on: the database
 * backend's /api/files/[id] denies every session read of an unstamped row.
 */

const mockUploadFile = jest.fn();

jest.mock("~/lib/storage", () => ({
    uploadFile: (input: unknown) => mockUploadFile(input),
    fetchFile: jest.fn(),
    deleteFileByUrl: jest.fn(),
    resolveStorageBackend: () => "database",
}));

import { createAppStoragePort } from "~/server/storage/port";

beforeEach(() => {
    jest.clearAllMocks();
    mockUploadFile.mockResolvedValue({
        url: "/api/files/9",
        pathname: "9",
        contentType: "text/plain",
        provider: "database",
    });
});

describe("createAppStoragePort().upload", () => {
    it("passes the workspace through to uploadFile", async () => {
        const port = createAppStoragePort();

        const result = await port.upload({
            filename: "notes.txt",
            data: Buffer.from("hello"),
            contentType: "text/plain",
            userId: "user_1",
            companyId: BigInt(42),
        });

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: "notes.txt",
                contentType: "text/plain",
                userId: "user_1",
                companyId: BigInt(42),
            })
        );
        expect(result).toEqual({
            url: "/api/files/9",
            pathname: "9",
            contentType: "text/plain",
            provider: "database",
        });
    });

    it("leaves the workspace unset when the caller has none", async () => {
        const port = createAppStoragePort();

        await port.upload({ filename: "a.bin", data: Buffer.from("x") });

        const [input] = mockUploadFile.mock.calls[0] as [Record<string, unknown>];
        expect(input.userId).toBe("system");
        expect(input.companyId).toBeUndefined();
    });
});
