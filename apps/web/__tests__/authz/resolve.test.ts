import { resolvePermissionsForRole, resolveRole } from "~/lib/authz/resolve";
import { BUILTIN_ROLE_PERMISSIONS } from "~/lib/authz/permissions";

const mockSelect = jest.fn();
let queuedRows: unknown[][] = [];

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
    },
}));

jest.mock("~/server/db/schema", () => ({
    workspaceRoles: {
        companyId: "roles.companyId",
        slug: "roles.slug",
        name: "roles.name",
        permissions: "roles.permissions",
    },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

function setupRows(...rows: unknown[][]) {
    queuedRows = [...rows];
    mockSelect.mockImplementation(() => {
        const result = queuedRows.shift() ?? [];
        return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue(result),
        };
    });
}

describe("resolveRole", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queuedRows = [];
        setupRows();
    });

    it("answers built-in roles without a query", async () => {
        const resolved = await resolveRole(BigInt(5), "admin");
        expect(resolved.custom).toBe(false);
        expect(resolved.permissions).toBe(BUILTIN_ROLE_PERMISSIONS.admin);
        expect(mockSelect).not.toHaveBeenCalled();
    });

    it("maps the legacy editor slug to member without a query", async () => {
        const resolved = await resolveRole(BigInt(5), "editor");
        expect(resolved.slug).toBe("member");
        expect(resolved.permissions).toBe(BUILTIN_ROLE_PERMISSIONS.member);
        expect(mockSelect).not.toHaveBeenCalled();
    });

    it("looks a custom slug up by company and keeps only catalogue permissions", async () => {
        setupRows([
            { name: "Finance lead", permissions: ["documents.read", "bogus", "documents.delete"] },
        ]);

        const resolved = await resolveRole(BigInt(5), "finance-lead");

        expect(resolved.custom).toBe(true);
        expect(resolved.name).toBe("Finance lead");
        expect([...resolved.permissions].sort()).toEqual(["documents.delete", "documents.read"]);
        expect(mockSelect).toHaveBeenCalledTimes(1);
    });

    it("fails closed for an unknown slug", async () => {
        setupRows([]);

        const permissions = await resolvePermissionsForRole(BigInt(5), "ghost");

        expect(permissions.size).toBe(0);
    });
});
