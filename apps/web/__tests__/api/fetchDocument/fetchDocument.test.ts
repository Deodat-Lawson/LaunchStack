const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: jest.fn(() => false),
    fetchBlob: jest.fn(),
    putFile: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
    isS3Storage: jest.fn(() => false),
    fetchFile: jest.fn(),
}));

// The dedicated second pool (~/server/db/core, `dbCore`) was deleted — the
// route now uses the engine's shared Drizzle client from ~/server/db.
jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

import { POST } from "~/app/api/fetchDocument/route";
import { db } from "~/server/db";

function mockAuthenticated(companyId = BigInt(1)) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            clerkUserId: "test-user-123",
            userPk: BigInt(7),
            companyId,
            role: "employer",
            status: "verified",
        },
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

describe("POST /api/fetchDocument", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should successfully fetch documents for authenticated user", async () => {
        mockAuthenticated(BigInt(1));

        const mockDocuments = [
            {
                id: 1,
                title: "Document 1",
                companyId: BigInt(1),
                url: "https://example.com/1.pdf",
                mimeType: "application/pdf",
                currentVersionId: null,
            },
            {
                id: 2,
                title: "Document 2",
                companyId: BigInt(1),
                url: "https://example.com/2.pdf",
                mimeType: "application/pdf",
                currentVersionId: null,
            },
        ];

        const mockSelect = jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(mockDocuments),
            }),
        });
        (db.select as jest.Mock) = mockSelect;

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toHaveLength(2);
        expect(json[0].id).toBe(1);
        expect(json[0].companyId).toBe(1);
    });

    it("returns 401 when workspace context fails", async () => {
        mockUnauthenticated();

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
        expect(db.select).not.toHaveBeenCalled();
    });

    it("should return empty array if no documents exist for company", async () => {
        mockAuthenticated(BigInt(2));

        const mockSelect = jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([]),
            }),
        });
        (db.select as jest.Mock) = mockSelect;

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual([]);
    });
});
