/** @jest-environment node */

const mockServer: Record<string, string | undefined> = {};
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServer };
    },
}));

import { currentStorageLocationId } from "~/server/storage/location";
import { refIdentity } from "~/server/storage/object-ref";
import { refFromStoredUrl } from "~/server/storage/stored-url";

beforeEach(() => {
    for (const key of Object.keys(mockServer)) delete mockServer[key];
    Object.assign(mockServer, {
        NEXT_PUBLIC_S3_ENDPOINT: "http://S3.internal:8333/storage///",
        S3_PUBLIC_ENDPOINT: "https://cdn.example/storage",
        S3_BUCKET_NAME: "documents",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_StoreABC_secret",
        UPLOADTHING_TOKEN: Buffer.from(
            JSON.stringify({ appId: "app123", apiKey: "sk_test", regions: ["iad1"] })
        ).toString("base64"),
    });
});

describe("storage location identity", () => {
    it("uses normalized endpoints and SDK token identities", () => {
        expect(currentStorageLocationId("s3")).toBe("s3:http://s3.internal:8333/storage@documents");
        expect(currentStorageLocationId("database")).toBe("database:file_uploads");
        expect(currentStorageLocationId("vercel-blob")).toBe("vercel-blob:storeabc");
        expect(currentStorageLocationId("uploadthing")).toBe("uploadthing:app123");
        expect(
            refIdentity({
                adapter: "database",
                storageLocationId: "database:file_uploads",
                key: "42",
            })
        ).toBe("database\u0000database:file_uploads\u000042");
    });

    it("refuses unavailable or malformed provider configuration", () => {
        mockServer.NEXT_PUBLIC_S3_ENDPOINT = "not a URL";
        mockServer.BLOB_READ_WRITE_TOKEN = "not-a-token";
        mockServer.UPLOADTHING_TOKEN = "not-a-token";
        expect(currentStorageLocationId("s3")).toBeNull();
        expect(currentStorageLocationId("vercel-blob")).toBeNull();
        expect(currentStorageLocationId("uploadthing")).toBeNull();
        mockServer.NEXT_PUBLIC_S3_ENDPOINT = "https://s3.example";
        delete mockServer.S3_BUCKET_NAME;
        delete mockServer.BLOB_READ_WRITE_TOKEN;
        delete mockServer.UPLOADTHING_TOKEN;
        expect(currentStorageLocationId("s3")).toBeNull();
        expect(currentStorageLocationId("vercel-blob")).toBeNull();
        expect(currentStorageLocationId("uploadthing")).toBeNull();
    });
});

describe("refFromStoredUrl", () => {
    it.each(["/api/files/42", "http://app:3000/api/files/42?token=old"])(
        "recognizes internal database URL %s",
        url => {
            expect(refFromStoredUrl(url)).toEqual({
                ok: true,
                ref: { adapter: "database", storageLocationId: "database:file_uploads", key: "42" },
            });
        }
    );

    it("only recognizes absolute database URLs on the configured internal origin", () => {
        mockServer.APP_PUBLIC_URL = "https://app.example/base";
        expect(refFromStoredUrl("https://app.example/api/files/42")).toMatchObject({
            ok: true,
            ref: { key: "42" },
        });
        expect(refFromStoredUrl("https://foreign.example/api/files/42")).toEqual({
            ok: false,
            reason: "unrecognized",
        });
    });

    it.each([
        "http://s3.internal:8333/storage/documents/folder/file%20name.pdf",
        "https://cdn.example/storage/documents/folder/file%20name.pdf",
    ])("strips the bucket from the S3 key, including public endpoints: %s", url => {
        expect(refFromStoredUrl(url)).toEqual({
            ok: true,
            ref: {
                adapter: "s3",
                storageLocationId: "s3:http://s3.internal:8333/storage@documents",
                key: "folder/file name.pdf",
            },
        });
    });

    it("retains a foreign bucket's identity instead of targeting the configured bucket", () => {
        expect(refFromStoredUrl("https://cdn.example/storage/old-bucket/file.pdf")).toMatchObject({
            ok: true,
            ref: {
                storageLocationId: "s3:http://s3.internal:8333/storage@old-bucket",
                key: "file.pdf",
            },
        });
    });

    it.each(["public", "private"])(
        "reads Blob store identity from the %s host, not the current token",
        access => {
            expect(
                refFromStoredUrl(
                    `https://oldstore.${access}.blob.vercel-storage.com/documents/a%20b.pdf`
                )
            ).toEqual({
                ok: true,
                ref: {
                    adapter: "vercel-blob",
                    storageLocationId: "vercel-blob:oldstore",
                    key: "documents/a b.pdf",
                },
            });
        }
    );

    it.each([
        "https://utfs.io/f/key%20one",
        "https://uploadthing.com/f/key%20one",
        "https://app123.ufs.sh/f/key%20one",
    ])("recognizes UploadThing URL %s", url => {
        expect(refFromStoredUrl(url)).toEqual({
            ok: true,
            ref: {
                adapter: "uploadthing",
                storageLocationId: "uploadthing:app123",
                key: "key one",
            },
        });
    });

    it("uses a ufs.sh host's app even when no token is configured", () => {
        delete mockServer.UPLOADTHING_TOKEN;
        expect(refFromStoredUrl("https://oldapp.ufs.sh/f/key")).toMatchObject({
            ok: true,
            ref: { storageLocationId: "uploadthing:oldapp", key: "key" },
        });
        expect(refFromStoredUrl("https://utfs.io/f/key")).toEqual({
            ok: false,
            reason: "unrecognized",
        });
    });

    it("refuses multiple interpretations rather than picking a provider", () => {
        mockServer.S3_PUBLIC_ENDPOINT = "https://app123.ufs.sh";
        expect(refFromStoredUrl("https://app123.ufs.sh/f/key")).toEqual({
            ok: false,
            reason: "ambiguous",
        });
    });

    it("does not count equal public and internal S3 endpoints twice", () => {
        mockServer.S3_PUBLIC_ENDPOINT = mockServer.NEXT_PUBLIC_S3_ENDPOINT;
        expect(refFromStoredUrl("http://s3.internal:8333/storage/documents/key")).toMatchObject({
            ok: true,
        });
    });

    it.each([
        "https://external.example/file.pdf",
        "not a URL",
        "https://cdn.example/storage-suffix/documents/key",
        "https://store.public.blob.vercel-storage.com.evil.example/key",
        "https://utfs.io.evil.example/f/key",
        "https://app123.ufs.sh/f/%ZZ",
    ])("never throws on unrecognized URL %s", url => {
        expect(refFromStoredUrl(url)).toEqual({ ok: false, reason: "unrecognized" });
    });
});
