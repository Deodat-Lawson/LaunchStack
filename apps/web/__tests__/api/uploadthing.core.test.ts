import { NextResponse } from "next/server";
import type { UploadedFileData } from "uploadthing/types";

import { ourFileRouter } from "~/app/api/uploadthing/core";
import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("uploadthing/next", () => ({
    createUploadthing: () => () => ({
        middleware: (middleware: unknown) => ({
            onUploadComplete: (onUploadComplete: unknown) => ({ middleware, onUploadComplete }),
        }),
    }),
}));

const mockWorkspaceContext = jest.fn();
const mockRecordStoredObject = jest.fn();
const mockDeleteStoredObjects = jest.fn();
const mockDb = {};
const mockServer: Record<string, string | undefined> = {};

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockWorkspaceContext(),
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockDb }) }));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: (...args: unknown[]) => mockRecordStoredObject(...args),
}));
jest.mock("~/server/storage/delete-objects", () => ({
    deleteStoredObjects: (...args: unknown[]) => mockDeleteStoredObjects(...args),
}));
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServer };
    },
}));

type Metadata = { userId: string; companyId: string };
type TestRoute = {
    middleware: () => Promise<Metadata>;
    onUploadComplete: (input: { metadata: Metadata; file: UploadedFileData }) => Promise<unknown>;
};
const metadata = { userId: "user-a", companyId: "9007199254740993" };
const file: UploadedFileData = {
    name: "memo.pdf",
    size: 32,
    type: "application/pdf",
    key: "file-key",
    customId: null,
    url: "https://utfs.io/f/deprecated-key",
    appUrl: "https://utfs.io/a/old-app/file-key",
    ufsUrl: "https://original-app.ufs.sh/f/file-key?signature=private-token",
    fileHash: "abc123",
};
const ref = {
    adapter: "uploadthing",
    storageLocationId: "uploadthing:original-app",
    key: "file-key",
};

beforeEach(() => {
    jest.resetAllMocks();
    mockWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: BigInt(metadata.companyId) }),
    });
    mockRecordStoredObject.mockResolvedValue(undefined);
    mockDeleteStoredObjects.mockResolvedValue([{ ref, outcome: "deleted" }]);
    mockServer.UPLOADTHING_TOKEN = Buffer.from(JSON.stringify({ appId: "current-app" })).toString(
        "base64"
    );
    jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe.each(Object.keys(ourFileRouter) as (keyof typeof ourFileRouter)[])("%s", endpoint => {
    const route = ourFileRouter[endpoint] as unknown as TestRoute;

    it("preserves Unauthorized for a missing session", async () => {
        mockWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        await expect(route.middleware()).rejects.toThrow("Unauthorized");
    });

    it("serializes the active company without losing bigint precision", async () => {
        await expect(route.middleware()).resolves.toEqual(metadata);
    });

    it("does not accept a denied active workspace", async () => {
        mockWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        });
        await expect(route.middleware()).rejects.toThrow();
    });

    it("records the exact ufsUrl and its original app identity before returning it", async () => {
        const result = await route.onUploadComplete({ metadata, file });
        expect(mockRecordStoredObject).toHaveBeenCalledWith(mockDb, {
            ref,
            url: file.ufsUrl,
            companyId: BigInt(metadata.companyId),
            source: "uploadthing",
            contentType: file.type,
            sizeBytes: file.size,
            checksum: file.fileHash,
        });
        expect(result).toEqual({
            ok: true,
            uploadedBy: metadata.userId,
            fileUrl: file.ufsUrl,
            filename: file.name,
        });
    });

    it("recognizes legacy URLs using the configured app", async () => {
        await route.onUploadComplete({
            metadata,
            file: { ...file, ufsUrl: "https://utfs.io/f/file-key" },
        });
        expect(mockRecordStoredObject).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({
                ref: { ...ref, storageLocationId: "uploadthing:current-app" },
                url: "https://utfs.io/f/file-key",
            })
        );
    });

    it("falls back to the callback key for a legacy app URL", async () => {
        const ufsUrl = "https://uploadthing.com/a/current-app/file-key";
        await route.onUploadComplete({ metadata, file: { ...file, ufsUrl } });
        expect(mockRecordStoredObject).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({
                ref: { ...ref, storageLocationId: "uploadthing:current-app" },
                url: ufsUrl,
            })
        );
    });

    it.each(["not-a-url", "https://unknown.example/file-key"])(
        "returns failure serverData when object identity cannot be derived from %s",
        async ufsUrl => {
            await expect(
                route.onUploadComplete({ metadata, file: { ...file, ufsUrl } })
            ).resolves.toEqual({
                ok: false,
                error: "storage_record_failed",
            });
            expect(mockRecordStoredObject).not.toHaveBeenCalled();
            expect(mockDeleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it("compensates a failed record and returns failure serverData without exposing a URL", async () => {
        const error = new Error("ledger unavailable");
        mockRecordStoredObject.mockRejectedValue(error);
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        expect(mockDeleteStoredObjects).toHaveBeenCalledWith([ref]);
    });

    it.each(["blocked", "retryable"])("warns when compensation is %s", async outcome => {
        const error = new Error("ledger unavailable");
        mockRecordStoredObject.mockRejectedValue(error);
        mockDeleteStoredObjects.mockResolvedValue([{ ref, outcome }]);
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        expect(console.warn).toHaveBeenCalled();
    });

    it("warns when compensation throws and still returns failure serverData", async () => {
        const error = new Error("ledger unavailable");
        mockRecordStoredObject.mockRejectedValue(error);
        mockDeleteStoredObjects.mockRejectedValue(new Error("provider unavailable"));
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        expect(console.warn).toHaveBeenCalled();
    });
});
