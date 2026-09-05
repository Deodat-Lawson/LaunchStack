/**
 * The document list is the first place a restricted folder must disappear:
 * the read scope goes into the WHERE clause, and each row says whether the
 * document itself is restricted.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import type { SQL } from "drizzle-orm";

import type { DocumentScope } from "~/lib/authz/scope-types";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

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

// The scope predicate is asserted by structure — was the real one used with
// the right scope — not by re-implementing its SQL here.
const mockScopedDocumentWhere = jest.fn();
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint, scope: DocumentScope) =>
        mockScopedDocumentWhere(companyId, scope),
}));

import { POST } from "~/app/api/fetchDocument/route";
import { db } from "~/server/db";

const SCOPE_MARKER = { marker: "scoped-where" } as unknown as SQL;

function mockAuthenticated(companyId = BigInt(1), scope?: DocumentScope) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ authUserId: "test-user-123", companyId, scope }),
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

function docRow(id: number, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: `Document ${id}`,
        category: "General",
        companyId: BigInt(1),
        url: `https://example.com/${id}.pdf`,
        mimeType: "application/pdf",
        currentVersionId: null,
        restricted: null,
        ...overrides,
    };
}

/** Captures the predicate the route hands to `.where()` and resolves `rows`. */
function mockDocumentQuery(rows: Record<string, unknown>[]) {
    const where = jest.fn().mockResolvedValue(rows);
    (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({ where }),
        }),
    });
    return where;
}

describe("POST /api/fetchDocument", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockScopedDocumentWhere.mockReturnValue(SCOPE_MARKER);
    });

    it("should successfully fetch documents for authenticated user", async () => {
        mockAuthenticated(BigInt(1));
        mockDocumentQuery([docRow(1), docRow(2)]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toHaveLength(2);
        expect(json[0].id).toBe(1);
        expect(json[0].companyId).toBe(1);
        expect(json[0].restricted).toBe(false);
    });

    it("reads through the caller's scope predicate, not a bare company filter", async () => {
        const scope: DocumentScope = {
            kind: "except",
            deniedCategories: ["Board"],
            deniedDocumentIds: [9],
            allowedDocumentIds: [],
        };
        mockAuthenticated(BigInt(1), scope);
        const where = mockDocumentQuery([docRow(1)]);

        await POST(new Request("http://localhost/api/fetchDocument", { method: "POST" }));

        expect(mockScopedDocumentWhere).toHaveBeenCalledWith(BigInt(1), scope);
        expect(where).toHaveBeenCalledWith(SCOPE_MARKER);
    });

    it("marks individually restricted documents the caller was granted", async () => {
        mockAuthenticated(BigInt(1));
        mockDocumentQuery([docRow(1), docRow(2, { restricted: true })]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(json.map((d: { restricted: boolean }) => d.restricted)).toEqual([false, true]);
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

    it("returns 403 for a role without documents.read", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "custom-nothing", permissions: [] }),
        });

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );

        expect(response.status).toBe(403);
        expect(db.select).not.toHaveBeenCalled();
    });

    it("should return empty array if no documents exist for company", async () => {
        mockAuthenticated(BigInt(2));
        mockDocumentQuery([]);

        const response = await POST(
            new Request("http://localhost/api/fetchDocument", { method: "POST" })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual([]);
    });
});
