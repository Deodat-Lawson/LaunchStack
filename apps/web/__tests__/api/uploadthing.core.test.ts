import { NextResponse } from "next/server";
import type { UploadedFileData } from "uploadthing/types";

import { ourFileRouter } from "~/app/api/uploadthing/core";
import { refFromStoredUrl } from "~/server/storage/stored-url";
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
const mockDiscardUnrecordedObject = jest.fn();
const mockDb = {};
const mockServer: Record<string, string | undefined> = {};

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockWorkspaceContext(),
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockDb }) }));
jest.mock("~/server/storage/ledger", () => ({
    recordStoredObject: (...args: unknown[]) => mockRecordStoredObject(...args),
}));
jest.mock("~/server/storage/compensate", () => ({
    discardUnrecordedObject: (...args: unknown[]) => mockDiscardUnrecordedObject(...args),
}));
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServer };
    },
}));

type Metadata = { userId: string; companyId: string };
type TestRoute = {
    middleware: () => Promise<Metadata>;
    onUploadComplete: (input: {
        metadata: Metadata;
        file: UploadedFileData;
    }) => Promise<
        | { ok: true; uploadedBy: string; fileUrl: string; filename: string }
        | { ok: false; error: "storage_record_failed" }
    >;
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
    mockDiscardUnrecordedObject.mockResolvedValue(true);
    for (const key of Object.keys(mockServer)) delete mockServer[key];
    mockServer.NEXT_PUBLIC_S3_ENDPOINT = "https://s3.internal/objects/";
    mockServer.S3_PUBLIC_ENDPOINT = "https://files.example/objects/";
    mockServer.S3_BUCKET_NAME = "documents";
    mockServer.UPLOADTHING_TOKEN = Buffer.from(JSON.stringify({ appId: "current-app" })).toString(
        "base64"
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
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
        const recorded = mockRecordStoredObject.mock.calls[0]![1] as { ref: unknown };
        if (!result.ok) throw new Error("Expected successful upload");
        expect(refFromStoredUrl(result.fileUrl)).toEqual({
            ok: true,
            ref: recorded.ref,
        });
        expect(mockDiscardUnrecordedObject).not.toHaveBeenCalled();
    });

    it.each(["utfs.io", "uploadthing.com"])(
        "recognizes legacy /f URLs on %s using the configured app",
        async host => {
            const ufsUrl = `https://${host}/f/file-key?signature=private-token`;
            const result = await route.onUploadComplete({
                metadata,
                file: { ...file, ufsUrl },
            });
            const legacyRef = { ...ref, storageLocationId: "uploadthing:current-app" };
            expect(mockRecordStoredObject).toHaveBeenCalledWith(
                mockDb,
                expect.objectContaining({ ref: legacyRef, url: ufsUrl })
            );
            expect(result).toEqual({
                ok: true,
                uploadedBy: metadata.userId,
                fileUrl: ufsUrl,
                filename: file.name,
            });
            if (!result.ok) throw new Error("Expected successful legacy upload");
            expect(refFromStoredUrl(result.fileUrl)).toEqual({
                ok: true,
                ref: legacyRef,
            });
        }
    );

    it.each([
        "not-a-url",
        "https://unknown.example/file-key?signature=private-token",
        "https://utfs.io/a/current-app/file-key",
        "https://uploadthing.com/a/current-app/file-key",
        "https://utfs.io/f/%E0%A4%A",
        "https://utfs.io/f/",
        "http://utfs.io/f/file-key",
        "https://store.public.blob.vercel-storage.com/file-key",
    ])("fails and compensates an unrecognized or non-UploadThing URL: %s", async ufsUrl => {
        await expect(
            route.onUploadComplete({ metadata, file: { ...file, ufsUrl } })
        ).resolves.toEqual({ ok: false, error: "storage_record_failed" });
        const cleanupRef = { ...ref, storageLocationId: "uploadthing:current-app" };
        expect(mockRecordStoredObject).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "[UploadThing] Cannot identify uploaded object:",
            expect.any(String),
            cleanupRef
        );
        expect(mockDiscardUnrecordedObject).toHaveBeenCalledWith(cleanupRef, "UploadThing");
        expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
            "private-token"
        );
    });

    it("rejects ambiguous URLs and compensates the callback key in the current app", async () => {
        mockServer.NEXT_PUBLIC_S3_ENDPOINT = "https://original-app.ufs.sh";
        mockServer.S3_BUCKET_NAME = "f";
        expect(refFromStoredUrl(file.ufsUrl)).toEqual({ ok: false, reason: "ambiguous" });
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        const cleanupRef = { ...ref, storageLocationId: "uploadthing:current-app" };
        expect(mockRecordStoredObject).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "[UploadThing] Cannot identify uploaded object:",
            "ambiguous",
            cleanupRef
        );
        expect(mockDiscardUnrecordedObject).toHaveBeenCalledWith(cleanupRef, "UploadThing");
    });

    it.each([
        undefined,
        "not-base64",
        Buffer.from(JSON.stringify({ regions: ["us-west-2"] })).toString("base64"),
    ])("logs the callback key when token %s provides no cleanup location", async token => {
        mockServer.UPLOADTHING_TOKEN = token;
        await expect(
            route.onUploadComplete({
                metadata,
                file: { ...file, ufsUrl: "https://utfs.io/f/file-key?signature=private-token" },
            })
        ).resolves.toEqual({ ok: false, error: "storage_record_failed" });
        expect(mockRecordStoredObject).not.toHaveBeenCalled();
        expect(mockDiscardUnrecordedObject).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "[UploadThing] Cannot identify uploaded object:",
            "unrecognized",
            { key: file.key }
        );
        expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
            "private-token"
        );
    });

    it("uses a parsed app identity even without a configured current location", async () => {
        delete mockServer.UPLOADTHING_TOKEN;
        mockRecordStoredObject.mockRejectedValue(new Error("ledger unavailable"));
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        expect(mockDiscardUnrecordedObject).toHaveBeenCalledWith(ref, "UploadThing");
    });

    it("logs ledger failures before shared compensation and still returns typed failure", async () => {
        const error = new Error("ledger unavailable");
        mockRecordStoredObject.mockRejectedValue(error);
        mockDiscardUnrecordedObject.mockResolvedValue(false);
        await expect(route.onUploadComplete({ metadata, file })).resolves.toEqual({
            ok: false,
            error: "storage_record_failed",
        });
        expect(console.error).toHaveBeenCalledWith(
            "[UploadThing] Failed to record uploaded object:",
            error,
            ref
        );
        expect(mockDiscardUnrecordedObject).toHaveBeenCalledWith(ref, "UploadThing");
        expect(jest.mocked(console.error).mock.invocationCallOrder[0]).toBeLessThan(
            mockDiscardUnrecordedObject.mock.invocationCallOrder[0]!
        );
        expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
            "private-token"
        );
    });
});
