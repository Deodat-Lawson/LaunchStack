import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET } from "~/app/api/Categories/GetCategories/route";
import { db } from "~/server/db";
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

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

const CREATED = new Date("2026-01-01T00:00:00.000Z");

function mockCtx(role: string, companyId = BigInt(1), scope?: DocumentScope) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role, companyId, scope }),
    });
}

interface CategoryRow {
    id: number;
    name: string;
    companyId: bigint;
    createdAt: Date;
    updatedAt: Date | null;
    visibility: string | null;
}

function row(id: number, name: string, restricted = false, companyId = BigInt(1)): CategoryRow {
    return {
        id,
        name,
        companyId,
        createdAt: CREATED,
        updatedAt: null,
        visibility: restricted ? "restricted" : null,
    };
}

function mockCategories(rows: CategoryRow[]) {
    (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(rows),
            }),
        }),
    });
}

function request() {
    return new Request("http://localhost/api/Categories/GetCategories");
}

describe("GET /api/Categories/GetCategories", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns every folder with its restricted flag to an owner", async () => {
        mockCtx("owner");
        mockCategories([row(1, "Category 1"), row(2, "Board", true)]);

        const response = await GET(request());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual([
            {
                id: 1,
                name: "Category 1",
                companyId: 1,
                createdAt: CREATED.toISOString(),
                updatedAt: null,
                restricted: false,
            },
            {
                id: 2,
                name: "Board",
                companyId: 1,
                createdAt: CREATED.toISOString(),
                updatedAt: null,
                restricted: true,
            },
        ]);
    });

    it("lets any member with documents.read list folders", async () => {
        mockCtx("member", BigInt(2));
        mockCategories([row(10, "Owner Category", false, BigInt(2))]);

        const response = await GET(request());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
            expect.objectContaining({ id: 10, name: "Owner Category", restricted: false }),
        ]);
    });

    it("filters out folders outside an `except` scope", async () => {
        mockCtx("member", BigInt(1), {
            kind: "except",
            deniedCategories: ["Board"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        });
        mockCategories([row(1, "General"), row(2, "Board", true), row(3, "Legal", true)]);

        const response = await GET(request());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.map((c: { name: string }) => c.name)).toEqual(["General", "Legal"]);
        // A restricted folder the caller was granted still says it is restricted.
        expect(json[1].restricted).toBe(true);
    });

    it("shows a guest only the folders in their `only` scope", async () => {
        mockCtx("guest", BigInt(1), {
            kind: "only",
            allowedCategories: ["Board"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        });
        mockCategories([row(1, "General"), row(2, "Board", true)]);

        const response = await GET(request());
        const json = await response.json();

        expect(json).toEqual([expect.objectContaining({ name: "Board", restricted: true })]);
    });

    it("returns an empty array when the company has no categories", async () => {
        mockCtx("owner");
        mockCategories([]);

        const response = await GET(request());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("returns 401 when workspace context fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
            }),
        });

        const response = await GET(request());

        expect(response.status).toBe(401);
    });

    it("returns 403 for a role without documents.read", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "custom-nothing", permissions: [] }),
        });

        const response = await GET(request());
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.permission).toBe("documents.read");
        expect(db.select).not.toHaveBeenCalled();
    });

    it("returns 500 on database error", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            mockCtx("owner");
            (db.select as jest.Mock).mockReturnValue({
                from: jest.fn().mockReturnValue({
                    leftJoin: jest.fn().mockReturnValue({
                        where: jest.fn().mockRejectedValue(new Error("db down")),
                    }),
                }),
            });

            const response = await GET(request());

            expect(response.status).toBe(500);
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
