/**
 * /api/upload/batches — identity and tenant come from requireWorkspaceContext.
 * The request schema no longer carries a `userId` at all, so a spoofed body or
 * query value cannot reach the batch lookup even by accident.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();
const mockDbSelect = jest.fn();
const mockDbUpdate = jest.fn();
const mockRegisteredFile = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
    },
}));
jest.mock("~/env", () => ({
    env: { server: { NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example", S3_BUCKET_NAME: "files" } },
}));

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

// ADR-014 creation defaults for what the route inserted; tested with ownership.
jest.mock("~/server/workspace/added-documents", () => ({
    recordUpload: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("~/server/services/folder-access", () => ({
    FOLDER_EDIT_DENIED: "You do not have edit access to this folder.",
    canEditFolder: jest.fn().mockResolvedValue(true),
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { standard: {}, strict: {} },
}));

jest.mock("~/server/services/upload-batches", () => ({
    createUploadBatch: jest.fn(),
    findBatchOwnedByUser: jest.fn(),
    refreshBatchAggregates: jest.fn(),
    updateBatchStatus: jest.fn(),
    toFileSizeBigint: (size: number) => BigInt(size),
    serializeBatch: jest.fn((batch: unknown) => batch),
}));

import { POST as createBatch } from "~/app/api/upload/batches/route";
import { GET as getBatch } from "~/app/api/upload/batches/[batchId]/route";
import { POST as registerFiles } from "~/app/api/upload/batches/[batchId]/files/route";
import { createUploadBatch, findBatchOwnedByUser } from "~/server/services/upload-batches";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const createUploadBatchMock = createUploadBatch as jest.MockedFunction<typeof createUploadBatch>;
const findBatchOwnedByUserMock = findBatchOwnedByUser as jest.MockedFunction<
    typeof findBatchOwnedByUser
>;

function mockAuthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user_session",
            userPk: BigInt(41),
            companyId: BigInt(7),
            role: "owner",
        }),
    });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    });
}

function postRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/upload/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/upload/batches", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
        createUploadBatchMock.mockResolvedValue({
            batch: { id: "batch-1", status: "created" },
            files: [],
        } as never);
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
        const response = await createBatch(
            postRequest({ userId: "user_session", files: [{ filename: "a.pdf" }] })
        );
        expect(response.status).toBe(401);
        expect(createUploadBatchMock).not.toHaveBeenCalled();
    });

    it("creates the batch for the session user, ignoring a spoofed body userId", async () => {
        const response = await createBatch(
            postRequest({ userId: "attacker", files: [{ filename: "a.pdf" }] })
        );

        expect(response.status).toBe(201);
        expect(createUploadBatchMock).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "user_session",
                companyId: BigInt(7),
            })
        );
    });
});

describe("GET /api/upload/batches/[batchId]", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
    });

    it("returns 401 when there is no workspace context", async () => {
        mockUnauthenticated();
        const response = await getBatch(
            new Request("http://localhost/api/upload/batches/batch-1?userId=whoever"),
            { params: Promise.resolve({ batchId: "batch-1" }) }
        );
        expect(response.status).toBe(401);
        expect(findBatchOwnedByUserMock).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the session user even when the query names someone else", async () => {
        findBatchOwnedByUserMock.mockResolvedValue({
            id: "batch-1",
            status: "created",
            files: [],
        } as never);

        const response = await getBatch(
            new Request("http://localhost/api/upload/batches/batch-1?userId=attacker"),
            { params: Promise.resolve({ batchId: "batch-1" }) }
        );

        expect(response.status).toBe(200);
        expect(findBatchOwnedByUserMock).toHaveBeenCalledWith("batch-1", "user_session", true);
    });

    it("returns 404 when the batch belongs to another user", async () => {
        findBatchOwnedByUserMock.mockResolvedValue(undefined as never);

        const response = await getBatch(
            new Request("http://localhost/api/upload/batches/batch-1"),
            { params: Promise.resolve({ batchId: "batch-1" }) }
        );
        expect(response.status).toBe(404);
    });
});

describe("POST /api/upload/batches/[batchId]/files stored URLs", () => {
    const canonical = "https://s3.example/files/documents/owned.pdf";
    const register = (urls: string[]) =>
        registerFiles(
            postRequest({
                files: urls.map((storageUrl, index) => ({
                    filename: `file-${index}.pdf`,
                    storageUrl,
                })),
            }),
            { params: Promise.resolve({ batchId: "batch-1" }) }
        );

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticated();
        findBatchOwnedByUserMock.mockResolvedValue({
            id: "batch-1",
            status: "uploading",
            files: [],
        } as never);
        mockDbSelect.mockReturnValue({
            from: () => ({
                where: () => Promise.resolve([{ companyId: 7n, url: canonical, deletedAt: null }]),
            }),
        });
        mockRegisteredFile.mockReturnValue({
            where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
        });
        mockDbUpdate.mockReturnValue({ set: mockRegisteredFile });
    });

    it("rejects a noncanonical provider URL before registering any file", async () => {
        const response = await register([
            canonical,
            "https://s3.example/files/documents/%6fwned.pdf",
        ]);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: expect.any(String) });
        expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("registers a live owned ledger URL without rewriting it", async () => {
        const response = await register([canonical]);
        expect(response.status).toBe(200);
        expect(mockRegisteredFile).toHaveBeenCalledWith(
            expect.objectContaining({ storageUrl: canonical })
        );
    });

    it("rejects a foreign database file", async () => {
        mockDbSelect.mockReturnValue({
            from: () => ({ where: () => Promise.resolve([{ companyId: 99n }]) }),
        });
        const response = await register(["/api/files/123"]);
        expect(response.status).toBe(404);
        expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("does not treat another provider's location as an internal upload", async () => {
        const response = await register(["https://another.public.blob.vercel-storage.com/doc.pdf"]);
        expect(response.status).toBe(200);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });
});
