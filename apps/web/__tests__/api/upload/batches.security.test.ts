/**
 * /api/upload/batches — identity comes from the Clerk session; body/query
 * userId values are accepted for wire-compat but ignored.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/server/db", () => ({
    db: { select: jest.fn() },
}));

jest.mock("~/server/services/upload-batches", () => ({
    createUploadBatch: jest.fn(),
    findBatchOwnedByUser: jest.fn(),
    serializeBatch: jest.fn((batch: unknown) => batch),
}));

import { POST as createBatch } from "~/app/api/upload/batches/route";
import { GET as getBatch } from "~/app/api/upload/batches/[batchId]/route";
import { db } from "~/server/db";
import {
    createUploadBatch,
    findBatchOwnedByUser,
} from "~/server/services/upload-batches";

const createUploadBatchMock = createUploadBatch as jest.MockedFunction<typeof createUploadBatch>;
const findBatchOwnedByUserMock = findBatchOwnedByUser as jest.MockedFunction<
    typeof findBatchOwnedByUser
>;

function mockUserLookup(user: { id: number; userId: string; companyId: bigint } | null) {
    const where = jest.fn().mockResolvedValue(user ? [user] : []);
    const from = jest.fn().mockReturnValue({ where });
    (db.select as jest.Mock).mockReturnValue({ from });
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
        mockClerk.userId = "user_session";
        mockUserLookup({ id: 41, userId: "user_session", companyId: 7n });
        createUploadBatchMock.mockResolvedValue({
            batch: { id: "batch-1", status: "created" },
            files: [],
        } as never);
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await createBatch(
            postRequest({ userId: "user_session", files: [{ filename: "a.pdf" }] })
        );
        expect(response.status).toBe(401);
        expect(createUploadBatchMock).not.toHaveBeenCalled();
    });

    it("creates the batch for the session user, ignoring a spoofed body userId", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const response = await createBatch(
                postRequest({ userId: "attacker", files: [{ filename: "a.pdf" }] })
            );

            expect(response.status).toBe(201);
            expect(createUploadBatchMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: "user_session",
                    companyId: 7n,
                })
            );
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Ignoring body userId=attacker")
            );
        } finally {
            consoleWarnSpy.mockRestore();
        }
    });
});

describe("GET /api/upload/batches/[batchId]", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClerk.userId = "user_session";
    });

    it("returns 401 when there is no Clerk session", async () => {
        mockClerk.userId = null;
        const response = await getBatch(
            new Request("http://localhost/api/upload/batches/batch-1?userId=whoever"),
            { params: Promise.resolve({ batchId: "batch-1" }) }
        );
        expect(response.status).toBe(401);
        expect(findBatchOwnedByUserMock).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the session user even when the query names someone else", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
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
        } finally {
            consoleWarnSpy.mockRestore();
        }
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
