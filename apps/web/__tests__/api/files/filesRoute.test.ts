/**
 * GET /api/files/[id] access control.
 *
 * With FILE_ACCESS_HMAC_KEY configured the route requires one of: a valid
 * signed reference, the X-Service-Key header, or a Clerk session belonging to
 * the uploader / a member of a company whose document references the file.
 * With the key unset it stays legacy-open but warns loudly, once.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: jest.fn(() => false),
}));

jest.mock("~/lib/storage", () => ({
    fetchFile: jest.fn(),
}));

// Table-dispatched db mock: each select resolves based on which table it
// reads from, so query order inside the route does not matter.
const mockTableResults = new Map<unknown, unknown[]>();

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(() => ({
            from: (table: unknown) => ({
                where: () => Promise.resolve(mockTableResults.get(table) ?? []),
            }),
        })),
    },
}));

import { GET } from "~/app/api/files/[id]/route";
import {
    __resetFileAccessWarningForTests,
    signedFileUrl,
} from "~/server/security/file-access";
import { fileUploads, document } from "@launchstack/core/db/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";

const KEY = "test-hmac-key-0123456789abcdef";
const FILE_ID = 42;

const fileRow = {
    id: FILE_ID,
    userId: "user_owner",
    filename: "notes.txt",
    mimeType: "text/plain",
    fileData: Buffer.from("hello world").toString("base64"),
    fileSize: 11,
    storageProvider: "database",
    storageUrl: null,
    storagePathname: null,
    blobChecksum: null,
    createdAt: new Date(),
};

function requestFor(path = `/api/files/${FILE_ID}`, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, { headers });
}

function invoke(request: Request, id = String(FILE_ID)) {
    return GET(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/files/[id]", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __resetFileAccessWarningForTests();
        mockClerk.userId = null;
        mockTableResults.clear();
        mockTableResults.set(fileUploads, [fileRow]);
        process.env.FILE_ACCESS_HMAC_KEY = KEY;
    });

    afterAll(() => {
        delete process.env.FILE_ACCESS_HMAC_KEY;
    });

    it("returns 401 for unauthenticated requests when the key is configured", async () => {
        const response = await invoke(requestFor());
        expect(response.status).toBe(401);
    });

    it("returns 403 for a user from a company that does not own a referencing document", async () => {
        mockClerk.userId = "user_other_company";
        mockTableResults.set(users, [{ id: 7, companyId: 99n }]);
        mockTableResults.set(document, [{ companyId: 5n, url: `/api/files/${FILE_ID}` }]);
        mockTableResults.set(userCompanyMemberships, []);

        const response = await invoke(requestFor());
        expect(response.status).toBe(403);
    });

    it("returns 403 when no document references the file and the caller is not the uploader", async () => {
        mockClerk.userId = "user_other_company";
        mockTableResults.set(users, [{ id: 7, companyId: 5n }]);
        mockTableResults.set(document, []);

        const response = await invoke(requestFor());
        expect(response.status).toBe(403);
    });

    it("does not authorize via a document whose file id only shares a prefix", async () => {
        mockClerk.userId = "user_other_company";
        mockTableResults.set(users, [{ id: 7, companyId: 5n }]);
        // LIKE %/api/files/42% would match /api/files/421 — the exact-id
        // filter must reject it.
        mockTableResults.set(document, [{ companyId: 5n, url: "/api/files/421" }]);
        mockTableResults.set(userCompanyMemberships, []);

        const response = await invoke(requestFor());
        expect(response.status).toBe(403);
    });

    it("serves the file to its uploader", async () => {
        mockClerk.userId = "user_owner";

        const response = await invoke(requestFor());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello world");
        expect(response.headers.get("Content-Type")).toBe("text/plain");
    });

    it("serves the file to a member of the company owning a referencing document", async () => {
        mockClerk.userId = "user_colleague";
        mockTableResults.set(users, [{ id: 8, companyId: 5n }]);
        mockTableResults.set(document, [{ companyId: 5n, url: `/api/files/${FILE_ID}` }]);

        const response = await invoke(requestFor());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello world");
    });

    it("serves the file via secondary workspace membership", async () => {
        mockClerk.userId = "user_multi_workspace";
        mockTableResults.set(users, [{ id: 9, companyId: 99n }]);
        mockTableResults.set(document, [{ companyId: 5n, url: `/api/files/${FILE_ID}` }]);
        mockTableResults.set(userCompanyMemberships, [{ companyId: 5n }]);

        const response = await invoke(requestFor());
        expect(response.status).toBe(200);
    });

    it("serves the file to a service caller presenting X-Service-Key", async () => {
        const response = await invoke(requestFor(undefined, { "X-Service-Key": KEY }));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello world");
    });

    it("rejects a wrong X-Service-Key (falls through to session auth)", async () => {
        const response = await invoke(requestFor(undefined, { "X-Service-Key": "nope" }));
        expect(response.status).toBe(401);
    });

    it("serves the file via a signed, time-limited reference from signedFileUrl()", async () => {
        const signed = signedFileUrl(FILE_ID, 60);
        expect(signed).toMatch(new RegExp(`^/api/files/${FILE_ID}\\?exp=\\d+&sig=[0-9a-f]{64}$`));

        const response = await invoke(requestFor(signed));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello world");
    });

    it("rejects an expired signed reference", async () => {
        const signed = signedFileUrl(FILE_ID, 60);
        const url = new URL(`http://localhost${signed}`);
        const exp = Number(url.searchParams.get("exp"));

        jest.useFakeTimers({ now: (exp + 10) * 1000 });
        try {
            const response = await invoke(requestFor(signed));
            expect(response.status).toBe(401);
        } finally {
            jest.useRealTimers();
        }
    });

    it("rejects a signed reference for a different file id", async () => {
        const signed = signedFileUrl(FILE_ID + 1, 60);
        const params = new URL(`http://localhost${signed}`).searchParams;
        const response = await invoke(
            requestFor(`/api/files/${FILE_ID}?exp=${params.get("exp")}&sig=${params.get("sig")}`)
        );
        expect(response.status).toBe(401);
    });

    it("returns 404 for a missing file after passing auth", async () => {
        mockClerk.userId = "user_owner";
        mockTableResults.set(fileUploads, []);

        const response = await invoke(requestFor());
        expect(response.status).toBe(404);
    });

    describe("legacy-open mode (FILE_ACCESS_HMAC_KEY unset)", () => {
        beforeEach(() => {
            delete process.env.FILE_ACCESS_HMAC_KEY;
        });

        it("serves the file without auth and warns exactly once", async () => {
            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const first = await invoke(requestFor());
                expect(first.status).toBe(200);
                expect(await first.text()).toBe("hello world");

                const second = await invoke(requestFor());
                expect(second.status).toBe(200);

                const securityWarnings = warnSpy.mock.calls.filter(call =>
                    String(call[0]).includes("FILE_ACCESS_HMAC_KEY")
                );
                expect(securityWarnings).toHaveLength(1);
            } finally {
                warnSpy.mockRestore();
            }
        });
    });
});
