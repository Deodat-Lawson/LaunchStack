/**
 * `validateDocumentAccess` is the access validator injected into the
 * rag-search tool. It answers from the user's active membership — its
 * status, its role's permissions, and the document scope those resolve to —
 * never from the legacy global `users.role` / `users.status`.
 */

import { validateDocumentAccess } from "~/server/rag/access";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { resolveDocumentScope, scopedDocumentWhere } from "~/lib/authz/scope";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import type { DocumentScope } from "~/lib/authz/scope-types";

let mockQueuedRows: Record<string, unknown>[][] = [];
const mockSelectFields = jest.fn();
const mockWhere = jest.fn();

function mockBuilder() {
    const rows = mockQueuedRows.shift() ?? [];
    const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve(rows),
        from: () => builder,
        where: (predicate: unknown) => {
            mockWhere(predicate);
            return builder;
        },
    };
    return builder;
}

jest.mock("~/server/db/index", () => ({
    db: {
        select: (fields: unknown) => {
            mockSelectFields(fields);
            return mockBuilder();
        },
    },
}));

jest.mock("~/server/db/schema", () => ({
    users: { id: "users.id", companyId: "users.companyId", userId: "users.userId" },
    userCompanyMemberships: {
        userId: "memberships.userId",
        companyId: "memberships.companyId",
        role: "memberships.role",
        status: "memberships.status",
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: "document.id",
        title: "document.title",
        category: "document.category",
        companyId: "document.companyId",
    },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    and: (...args: unknown[]) => ({ op: "and", args }),
    inArray: (...args: unknown[]) => ({ op: "inArray", args }),
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: jest.fn(),
}));

jest.mock("~/lib/authz/resolve", () => ({
    resolvePermissionsForRole: jest.fn(),
}));

jest.mock("~/lib/authz/scope", () => ({
    resolveDocumentScope: jest.fn(),
    scopedDocumentWhere: jest.fn((companyId: bigint, scope: unknown) => ({
        op: "scoped",
        companyId,
        scope,
    })),
}));

const FINANCE_HIDDEN: DocumentScope = {
    kind: "except",
    deniedCategories: ["Finance"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

const USER_ROW = { id: 7, companyId: BigInt(5) };

describe("validateDocumentAccess", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        (resolveActiveCompanyForUser as jest.Mock).mockResolvedValue(BigInt(5));
        (resolvePermissionsForRole as jest.Mock).mockResolvedValue(
            builtinRolePermissions("member")
        );
        (resolveDocumentScope as jest.Mock).mockResolvedValue(FINANCE_HIDDEN);
    });

    it("keeps only the requested documents inside the member's scope", async () => {
        mockQueuedRows = [
            [USER_ROW],
            [{ role: "member", status: "active" }],
            // The scoped query already excluded the Finance document...
            [
                { id: 1, title: "Handbook", category: "People" },
                // ...and the in-memory re-check catches one that slipped through.
                { id: 2, title: "Budget", category: "Finance" },
            ],
        ];

        const result = await validateDocumentAccess("user-a", ["1", 2, "3"]);

        expect(result.validDocIds).toEqual([1]);
        expect([...result.documentTitles.entries()]).toEqual([[1, "Handbook"]]);
        expect(result.companyId).toBe("5");

        expect(resolveActiveCompanyForUser).toHaveBeenCalledWith(7, BigInt(5));
        expect(resolvePermissionsForRole).toHaveBeenCalledWith(BigInt(5), "member");
        expect(resolveDocumentScope).toHaveBeenCalledWith({
            companyId: BigInt(5),
            userPk: BigInt(7),
            role: "member",
            permissions: builtinRolePermissions("member"),
        });
        expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(5), FINANCE_HIDDEN);
        expect(mockWhere).toHaveBeenLastCalledWith({
            op: "and",
            args: [
                { op: "inArray", args: ["document.id", [1, 2, 3]] },
                { op: "scoped", companyId: BigInt(5), scope: FINANCE_HIDDEN },
            ],
        });
    });

    it("never reads the legacy users.role or users.status", async () => {
        mockQueuedRows = [[USER_ROW], [{ role: "member", status: "active" }], []];

        await validateDocumentAccess("user-a", [1]);

        const usersSelect = mockSelectFields.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(Object.values(usersSelect)).toEqual(["users.id", "users.companyId"]);
    });

    it("answers nothing for a membership that is not active", async () => {
        mockQueuedRows = [[USER_ROW], [{ role: "owner", status: "suspended" }]];

        const result = await validateDocumentAccess("user-a", [1]);

        expect(result.validDocIds).toEqual([]);
        expect(resolveDocumentScope).not.toHaveBeenCalled();
        expect(mockQueuedRows).toEqual([]);
    });

    it("answers nothing for a role without documents.read", async () => {
        mockQueuedRows = [[USER_ROW], [{ role: "reporting", status: "active" }]];
        (resolvePermissionsForRole as jest.Mock).mockResolvedValue(new Set(["analytics.view"]));

        const result = await validateDocumentAccess("user-a", [1]);

        expect(result.validDocIds).toEqual([]);
        expect(resolveDocumentScope).not.toHaveBeenCalled();
    });

    it("answers nothing when there is no membership in the active workspace", async () => {
        mockQueuedRows = [[USER_ROW], []];

        const result = await validateDocumentAccess("user-a", [1]);

        expect(result.validDocIds).toEqual([]);
        expect(resolvePermissionsForRole).not.toHaveBeenCalled();
    });

    it("fails closed when the active workspace cannot be resolved", async () => {
        mockQueuedRows = [[USER_ROW]];
        (resolveActiveCompanyForUser as jest.Mock).mockRejectedValue(new Error("no request"));
        const warn = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const result = await validateDocumentAccess("user-a", [1]);

        expect(result).toEqual({ validDocIds: [], documentTitles: new Map(), companyId: null });
        warn.mockRestore();
    });
});
