/**
 * /api/upload/batches — identity and tenant come from requireWorkspaceContext.
 * The request schema no longer carries a `userId` at all, so a spoofed body or
 * query value cannot reach the batch lookup even by accident.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

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
    serializeBatch: jest.fn((batch: unknown) => batch),
}));

import { POST as createBatch } from "~/app/api/upload/batches/route";
import { GET as getBatch } from "~/app/api/upload/batches/[batchId]/route";
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
