/**
 * POST /api/upload-local — the bytes half of adding a file. Every failure
 * names its cause: an upload cut off mid-body, storage refusing the write, or
 * a file over the limit. "Failed to upload file" is left for the unforeseen.
 */

import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";

import { POST } from "~/app/api/upload-local/route";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockUploadFile = jest.fn();
jest.mock("~/lib/storage", () => {
    class StorageError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "StorageError";
        }
    }
    return {
        StorageError,
        uploadFile: (...args: unknown[]) => mockUploadFile(...args) as unknown,
        resolveStorageBackend: () => "s3",
    };
});

const mockInsert = jest.fn();
jest.mock("~/server/db", () => ({
    db: { insert: (...args: unknown[]) => mockInsert(...args) as unknown },
}));

function multipart(file: { name: string; type: string; bytes: number }) {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    return new Request("http://localhost/api/upload-local", { method: "POST", body: form });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("POST /api/upload-local", () => {
    it("says the file arrived incomplete when the body cannot be parsed", async () => {
        // A multipart body that never reaches its closing boundary — what the
        // route sees when a connection drops, or when Next 15.5.7's middleware
        // hands it a body it has not finished buffering.
        const response = await POST(
            new Request("http://localhost/api/upload-local", {
                method: "POST",
                headers: { "Content-Type": "multipart/form-data; boundary=XyZ" },
                body: '--XyZ\r\nContent-Disposition: form-data; name="file"; filename="oct_15.m4a"\r\nContent-Type: audio/x-m4a\r\n\r\nhalf of a',
            })
        );

        expect(response.status).toBe(400);
        expect((await response.json()) as unknown).toEqual({
            error: "The file didn't arrive in one piece. Try again; if it keeps happening, ask an admin.",
        });
        expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("says storage refused the write, instead of a bare failure", async () => {
        const { StorageError } = jest.requireMock<{
            StorageError: new (message: string) => Error;
        }>("~/lib/storage");
        mockUploadFile.mockRejectedValue(new StorageError("[s3] socket hang up"));

        const response = await POST(
            multipart({ name: "memo.m4a", type: "audio/x-m4a", bytes: 64 })
        );

        expect(response.status).toBe(502);
        expect(((await response.json()) as { error: string }).error).toMatch(
            /couldn't be saved to storage/
        );
    });

    it("refuses a file over the limit by name and size", async () => {
        const response = await POST(
            multipart({ name: "day.m4a", type: "audio/x-m4a", bytes: 128 * 1024 * 1024 + 1 })
        );

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toBe(
            "File too large. Maximum size is 128MB."
        );
        expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("accepts the formats transcription now reads", async () => {
        mockUploadFile.mockResolvedValue({ url: "/api/files/9", provider: "database" });
        for (const [name, type] of [
            ["notes.wav", "audio/wav"],
            ["clip.flac", "audio/flac"],
            ["memo.m4a", "audio/x-m4a"],
        ] as const) {
            const response = await POST(multipart({ name, type, bytes: 32 }));
            expect(response.status).toBe(200);
        }
    });
});
