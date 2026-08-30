import { POST } from "~/app/api/artifacts/route";
import { db } from "~/server/db";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    ...jest.requireActual("~/lib/require-workspace-context"),
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

// Rate limiting is exercised by its own tests; here it just passes through.
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_req: Request, _preset: unknown, handler: () => Promise<Response>) => handler(),
}));

const mockAssertPublicHttpUrl = jest.fn();
const mockFetchPublicUrl = jest.fn();

jest.mock("~/server/security/url-guard", () => {
    class UrlGuardError extends Error {}
    return {
        UrlGuardError,
        assertPublicHttpUrl: (url: string) => mockAssertPublicHttpUrl(url),
        fetchPublicUrl: (url: string, init?: RequestInit) => mockFetchPublicUrl(url, init),
    };
});

jest.mock("~/server/db", () => ({
    db: { insert: jest.fn() },
}));

function mockCtx() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            authUserId: "user-123",
            userPk: BigInt(7),
            companyId: BigInt(42),
            role: "owner",
            status: "verified",
        },
    });
}

/** Captures the inserted values and echoes them back as the returned row. */
function mockInsert() {
    let captured: Record<string, unknown> = {};
    (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockImplementation((values: Record<string, unknown>) => {
            captured = values;
            return {
                returning: jest.fn().mockImplementation(() =>
                    Promise.resolve([
                        {
                            id: 1,
                            description: null,
                            updatedByUserId: null,
                            deletedAt: null,
                            starred: false,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            ...captured,
                        },
                    ])
                ),
            };
        }),
    });
    return () => captured;
}

function importRequest(body: unknown) {
    return new Request("http://localhost/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/artifacts", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("imports pasted content with a detected type and derived title", async () => {
        mockCtx();
        const inserted = mockInsert();

        const response = await POST(
            importRequest({
                content: "<!DOCTYPE html><html><head><title>Churn Report</title></head></html>",
                sourceUrl: "https://claude.ai/public/artifacts/abc",
            })
        );
        const json = (await response.json()) as { artifact: { title: string } };

        expect(response.status).toBe(201);
        expect(json.artifact.title).toBe("Churn Report");
        const values = inserted();
        expect(values.companyId).toBe(BigInt(42));
        expect(values.createdByUserId).toBe("user-123");
        expect(values.artifactType).toBe("html");
        expect(values.importMethod).toBe("paste");
        expect(values.sourceUrl).toBe("https://claude.ai/public/artifacts/abc");
        expect(values.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(mockFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("refuses to fetch claude.ai share links with a structured 422", async () => {
        mockCtx();

        const response = await POST(
            importRequest({
                fetchFromUrl: true,
                sourceUrl: "https://claude.ai/public/artifacts/abc",
            })
        );
        const json = (await response.json()) as { code?: string };

        expect(response.status).toBe(422);
        expect(json.code).toBe("claude_share_link");
        expect(mockFetchPublicUrl).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("fetches other URLs through the SSRF guard", async () => {
        mockCtx();
        const inserted = mockInsert();
        mockAssertPublicHttpUrl.mockResolvedValue(new URL("https://example.com/page"));
        mockFetchPublicUrl.mockResolvedValue(
            new Response("<html><head><title>Docs</title></head></html>", {
                status: 200,
                headers: { "Content-Type": "text/html" },
            })
        );

        const response = await POST(
            importRequest({ fetchFromUrl: true, sourceUrl: "https://example.com/page" })
        );

        expect(response.status).toBe(201);
        expect(mockAssertPublicHttpUrl).toHaveBeenCalledWith("https://example.com/page");
        expect(mockFetchPublicUrl).toHaveBeenCalled();
        expect(inserted().importMethod).toBe("url");
    });

    it("rejects a body with neither content nor a fetchable URL", async () => {
        mockCtx();

        const response = await POST(importRequest({ title: "No body" }));

        expect(response.status).toBe(400);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("passes the workspace-context failure response through", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });

        const response = await POST(importRequest({ content: "# hi" }));

        expect(response.status).toBe(401);
        expect(db.insert).not.toHaveBeenCalled();
    });
});
