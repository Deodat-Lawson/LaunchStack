import {
    authorizeInternalFileRef,
    parseInternalFileId,
    UploadAuthorizationError,
} from "~/server/services/internal-file-ref";
import { configureOcr } from "@launchstack/conversion/ocr/config";
import { authorizeStoredObjectUrl } from "~/server/storage/authorize-stored-object-url";

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    },
}));

jest.mock("~/env", () => ({
    env: {
        server: {
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example",
            S3_BUCKET_NAME: "files",
            BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store_test",
            UPLOADTHING_TOKEN: Buffer.from(
                JSON.stringify({ appId: "app", apiKey: "test", regions: ["iad1"] })
            ).toString("base64"),
        },
    },
}));

function setupFileQuery(rows: Record<string, unknown>[]) {
    const where = jest.fn().mockResolvedValue(rows.map(row => ({ deletedAt: null, ...row })));
    const from = jest.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValueOnce({ from });
}

const COMPANY = BigInt(5);

describe("parseInternalFileId", () => {
    it("recognizes relative and absolute internal file URLs", () => {
        expect(parseInternalFileId("/api/files/123")).toBe(123);
        expect(parseInternalFileId("http://app:3000/api/files/123")).toBe(123);
        expect(parseInternalFileId("https://example.com/api/files/123?t=abc")).toBe(123);
    });

    it.each([
        "/api/files/unused/../7",
        "/api/./files/7",
        "\\api\\files\\7",
        " \t/api/fi\tles/7 \t",
        "/api/files/9/../../../api/files/7",
    ])("recognizes the URL parser's database alias %j", url => {
        expect(parseInternalFileId(url)).toBe(7);
    });

    it("returns null for anything else", () => {
        expect(parseInternalFileId("https://cdn.example.com/doc.pdf")).toBeNull();
        expect(parseInternalFileId("/api/files/abc")).toBeNull();
        expect(parseInternalFileId("/api/files/123/extra")).toBeNull();
        expect(parseInternalFileId("/api/fi les/7")).toBeNull();
        expect(parseInternalFileId("/api/files/7 0")).toBeNull();
    });
});

describe("authorizeInternalFileRef", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configureOcr({
            appPublicUrl: "http://app:3000",
            fileAccessTokenSecret: "secret",
        });
    });

    afterEach(() => {
        configureOcr({});
    });

    it("returns null for external URLs without touching the database", async () => {
        await expect(
            authorizeInternalFileRef("https://cdn.example.com/doc.pdf", COMPANY)
        ).resolves.toBeNull();
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it.each([
        "/api/files/unused/../7",
        "/api/./files/7",
        "\\api\\files\\7",
        " \t/api/fi\tles/7 \t",
        "/api/files/9/../../../api/files/7",
    ])("keeps the legacy numeric helper result for %j", async url => {
        setupFileQuery([{ companyId: COMPANY }]);
        await expect(authorizeInternalFileRef(url, COMPANY)).resolves.toBe(7);
    });

    it.each([
        "https://s3.example/files/documents/owned.pdf",
        "https://store.public.blob.vercel-storage.com/owned.pdf",
        "https://app.ufs.sh/f/owned",
    ])("accepts a provider URL ledgered to this workspace: %s", async url => {
        setupFileQuery([{ companyId: COMPANY, url }]);
        await expect(authorizeInternalFileRef(url, COMPANY)).resolves.toBeNull();
        expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it.each([
        "https://s3.example/other-bucket/doc.pdf",
        "https://other.public.blob.vercel-storage.com/doc.pdf",
        "https://other.ufs.sh/f/doc",
    ])("accepts another provider location as an external link: %s", async url => {
        await expect(authorizeInternalFileRef(url, COMPANY)).resolves.toBeNull();
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it.each([
        "https://s3.example/files/documents/deleted.pdf",
        "https://store.public.blob.vercel-storage.com/deleted.pdf",
        "https://app.ufs.sh/f/deleted",
    ])("rejects a deleted ledger object even in this workspace: %s", async url => {
        setupFileQuery([{ companyId: COMPANY, url, deletedAt: new Date() }]);
        await expect(authorizeInternalFileRef(url, COMPANY)).rejects.toMatchObject({
            status: 404,
            copy: { key: "upload.server.errors.fileNotInWorkspace" },
        });
    });

    it.each([
        {
            canonical: "https://s3.example/files/documents/owned.pdf",
            alias: "https://s3.example/files/documents/%6fwned.pdf",
        },
        {
            canonical: "https://app.ufs.sh/f/owned",
            alias: "https://utfs.io/f/owned",
        },
    ])(
        "rejects noncanonical spellings of an owned provider object: $alias",
        async ({ canonical, alias }) => {
            setupFileQuery([{ companyId: COMPANY, url: canonical }]);
            await expect(authorizeInternalFileRef(alias, COMPANY)).rejects.toMatchObject({
                status: 404,
                copy: { key: "upload.server.errors.fileNotInWorkspace" },
            });
        }
    );

    it("rejects a ledgered S3 URL belonging to another company", async () => {
        setupFileQuery([{ companyId: 999n }]);
        await expect(
            authorizeInternalFileRef("https://s3.example/files/documents/victim.pdf", COMPANY)
        ).rejects.toMatchObject({
            status: 404,
            copy: { key: "upload.server.errors.fileNotInWorkspace" },
        });
    });

    it.each([{ rows: [] }, { rows: [{ companyId: null }] }])(
        "rejects an unledgered or unstamped provider URL without revealing existence",
        async ({ rows }) => {
            setupFileQuery(rows);
            await expect(
                authorizeInternalFileRef("https://s3.example/files/documents/missing.pdf", COMPANY)
            ).rejects.toMatchObject({
                status: 404,
                copy: { key: "upload.server.errors.fileNotInWorkspace" },
            });
        }
    );

    it("returns the file id when the workspace owns the row", async () => {
        setupFileQuery([{ companyId: COMPANY }]);

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).resolves.toBe(123);
    });

    it("rejects a file owned by another company", async () => {
        setupFileQuery([{ companyId: BigInt(999) }]);

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).rejects.toBeInstanceOf(
            UploadAuthorizationError
        );
    });

    it("rejects a row with no company stamp", async () => {
        setupFileQuery([{ companyId: null }]);

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).rejects.toBeInstanceOf(
            UploadAuthorizationError
        );
    });

    it("reports a missing row the same way as a foreign one", async () => {
        setupFileQuery([]);

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).rejects.toMatchObject({
            status: 404,
        });
    });

    // A caller that claims S3 storage used to keep the internal path intact all
    // the way to the token signer, which then handed the worker a valid
    // capability for another tenant's file.
    it("authorizes an absolute internal URL regardless of declared storage", async () => {
        setupFileQuery([{ companyId: BigInt(999) }]);

        await expect(
            authorizeInternalFileRef("http://app:3000/api/files/123", COMPANY)
        ).rejects.toBeInstanceOf(UploadAuthorizationError);
    });

    it("accepts a same-origin absolute URL with a trailing slash", async () => {
        setupFileQuery([{ companyId: COMPANY }]);

        await expect(
            authorizeInternalFileRef("http://app:3000/api/files/123/", COMPANY)
        ).resolves.toBe(123);
    });

    it("does not classify a foreign-host file path as internal", async () => {
        await expect(
            authorizeInternalFileRef("https://evil.example/api/files/123", COMPANY)
        ).resolves.toBeNull();
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("fails at ingress when the document converter has no signing secret", async () => {
        // ADR-004 replaced the ocr-worker with services/document-converter, so a
        // configured `converter` is what makes an out-of-process fetch (and thus
        // a signed token) mandatory.
        configureOcr({
            appPublicUrl: "http://app:3000",
            converter: { url: "http://document-converter:8002", apiKey: "k" },
        });
        setupFileQuery([{ companyId: COMPANY }]);

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).rejects.toMatchObject({
            status: 503,
        });
    });

    it("enforces the signing secret when OCR config is registered during the ownership query", async () => {
        // Cold process: authorize starts with an empty slot. The real `db` proxy
        // calls getEngine() → configureOcr mid-query; a stale cfg snapshot would
        // skip the missing-FILE_ACCESS_TOKEN_SECRET rejection.
        configureOcr({});
        const where = jest.fn().mockImplementation(async () => {
            configureOcr({
                appPublicUrl: "http://app:3000",
                converter: { url: "http://document-converter:8002", apiKey: "k" },
            });
            return [{ companyId: COMPANY }];
        });
        const from = jest.fn().mockReturnValue({ where });
        mockDbSelect.mockReturnValueOnce({ from });

        await expect(authorizeInternalFileRef("/api/files/123", COMPANY)).rejects.toMatchObject({
            status: 503,
        });
    });

    it("fails before enqueue when the request overrides to an OSS provider", async () => {
        configureOcr({
            appPublicUrl: "http://app:3000",
            defaultProvider: "AZURE",
        });
        setupFileQuery([{ companyId: COMPANY }]);

        await expect(
            authorizeInternalFileRef("/api/files/123", COMPANY, "DOCLING")
        ).rejects.toMatchObject({ status: 503 });
    });
});

describe("authorizeStoredObjectUrl", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configureOcr({});
    });

    afterEach(() => configureOcr({}));

    it("authorizes an owned database reference without requiring the OCR secret", async () => {
        setupFileQuery([{ companyId: COMPANY }]);
        await expect(authorizeStoredObjectUrl("/api/files/123", COMPANY)).resolves.toEqual({
            fileId: 123,
            url: "/api/files/123",
        });
    });

    it.each([
        "/api/files/unused/../7",
        "/api/./files/7",
        "\\api\\files\\7",
        " \t/api/fi\tles/7 \t",
        "/api/files/9/../../../api/files/7",
    ])("returns the canonical persistence URL for database alias %j", async url => {
        setupFileQuery([{ companyId: COMPANY }]);
        await expect(authorizeStoredObjectUrl(url, COMPANY)).resolves.toEqual({
            fileId: 7,
            url: "/api/files/7",
        });
        expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it("returns the exact live provider ledger URL alongside a null database id", async () => {
        const url = "https://s3.example/files/documents/owned.pdf";
        setupFileQuery([{ companyId: COMPANY, url }]);
        await expect(authorizeStoredObjectUrl(url, COMPANY)).resolves.toEqual({
            fileId: null,
            url,
        });
    });

    it.each([
        "https://s3.example/other/documents/owned.pdf",
        "https://another.public.blob.vercel-storage.com/owned.pdf",
        "https://another.ufs.sh/f/owned",
    ])("keeps parsed non-current provider locations external: %s", async url => {
        await expect(authorizeStoredObjectUrl(url, COMPANY)).resolves.toEqual({
            fileId: null,
            url,
        });
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("rejects a byte-identical owned provider URL after its ledger row is deleted", async () => {
        const url = "https://s3.example/files/documents/owned.pdf";
        setupFileQuery([{ companyId: COMPANY, url, deletedAt: new Date() }]);
        await expect(authorizeStoredObjectUrl(url, COMPANY)).rejects.toMatchObject({ status: 404 });
    });

    it("does not let another company's database file become a reference", async () => {
        setupFileQuery([{ companyId: 999n }]);
        await expect(authorizeStoredObjectUrl("/api/files/123", COMPANY)).rejects.toMatchObject({
            status: 404,
        });
    });
});
